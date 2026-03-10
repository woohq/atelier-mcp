import type { AtelierMcpServer } from "./server.js";
import { logger } from "../util/logger.js";

export interface SymmetryState {
  enabled: boolean;
  axis: "x" | "y" | "z";
  offset: number;
}

/**
 * Install symmetry middleware on the server.
 *
 * When symmetry is enabled, geometry-creating tools automatically create
 * a mirrored copy of the new object across the configured axis.
 *
 * The middleware wraps `bridge.execute` so that after any geometry-creating
 * bridge command completes, the created object is cloned and mirrored
 * on the browser side, and registered in the server-side scene engine.
 */
export function installSymmetryMiddleware(server: AtelierMcpServer): void {
  const state: SymmetryState = { enabled: false, axis: "x", offset: 0 };

  // Expose state getter/setter on the server instance
  (server as any).symmetry = {
    get: (): SymmetryState => ({ ...state }),
    set: (s: Partial<SymmetryState>): void => {
      Object.assign(state, s);
    },
  };

  // Map tool names to the bridge command name + param that holds the created object ID
  const TOOL_TO_BRIDGE: Record<string, string> = {
    create_primitive: "createPrimitive",
    create_mesh: "createMesh",
    extrude: "extrude",
    extrude_along_path: "extrudeAlongPath",
  };

  const originalExecute = server.bridge.execute.bind(server.bridge);

  server.bridge.execute = async (
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> => {
    const result = await originalExecute(command, params);

    if (!state.enabled) return result;

    // Check if this bridge command corresponds to a geometry tool
    const isGeometryCommand = Object.values(TOOL_TO_BRIDGE).includes(command);
    if (!isGeometryCommand) return result;

    const id = params.id as string | undefined;
    if (!id) return result;

    const mirrorId = `${id}_mirror`;

    try {
      // Clone the object on the browser side
      await originalExecute("clone", { sourceId: id, newId: mirrorId });

      // Apply mirror transform via the existing mirror bridge command
      await originalExecute("mirror", {
        sourceId: mirrorId,
        newId: mirrorId,
        axis: state.axis,
        offset: state.offset,
      });

      // Register the mirror in the server-side scene engine
      const sourceObj = server.scene.get(id);
      server.scene.create({
        id: mirrorId,
        name: mirrorId,
        type: sourceObj?.type ?? "mirror",
        metadata: {
          sourceId: id,
          mirrorAxis: state.axis,
          mirrorOffset: state.offset,
          autoMirrored: true,
        },
      });

      logger.debug("Symmetry auto-mirror created", {
        sourceId: id,
        mirrorId,
        axis: state.axis,
      });
    } catch (err) {
      // Mirror failure should not break the original geometry creation
      logger.warn("Symmetry auto-mirror failed", {
        sourceId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
  };
}
