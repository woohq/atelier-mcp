/**
 * Undo middleware — intercepts mutating tool calls and records undo entries
 * in the server's CommandHistory. Works with the existing undo/redo handlers
 * in session-tools.ts.
 */

import type { Middleware, ToolContext } from "./middleware.js";
import type { AtelierMcpServer } from "./server.js";
import type { SceneObject } from "../engine/scene-engine.js";
import { logger } from "../util/logger.js";

/** Tools that mutate scene state and should be undoable. */
const MUTATING_TOOLS = new Set([
  // Geometry / creation
  "create_primitive",
  "create_mesh",
  "create_group",
  "create_tube",
  "create_lathe",
  "extrude",
  "extrude_along_path",
  "clone",
  "mirror",
  "merge",
  "scatter",
  "smooth_merge",
  "smooth_boolean",
  // Scene manipulation
  "add_to_group",
  "transform",
  "remove_object",
  "clear_scene",
  "set_background",
  "set_shadow",
  "set_environment",
  // Geometry modification
  "boolean_op",
  "deform",
  "subdivide",
  "set_vertices",
  "push_pull",
  // Materials / textures
  "set_material",
  "set_texture",
  "generate_texture",
  // Lights / camera
  "set_light",
  "set_camera",
  // Shaders / post-processing
  "apply_post_process",
  "clear_post_process",
  "write_shader",
  "set_uniform",
]);

/**
 * Tools that create new objects. After execution, extract the created ID
 * from the result so we can remove it on undo.
 */
const CREATION_TOOLS = new Set([
  "create_primitive",
  "create_mesh",
  "create_group",
  "create_tube",
  "create_lathe",
  "extrude",
  "extrude_along_path",
  "clone",
  "mirror",
  "set_light",
]);

/**
 * Extracts the JSON payload from a tool result.
 * Tool handlers return { content: [{ type: "text", text: JSON.stringify(...) }] }.
 */
function extractResultPayload(result: unknown): Record<string, unknown> | null {
  if (result == null || typeof result !== "object") return null;
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (!Array.isArray(r.content)) return null;
  const textEntry = r.content.find((c) => c.type === "text" && typeof c.text === "string");
  if (!textEntry?.text) return null;
  try {
    return JSON.parse(textEntry.text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Deep-clone a SceneObject for snapshotting.
 */
function snapshotObject(obj: SceneObject): SceneObject {
  return {
    id: obj.id,
    name: obj.name,
    type: obj.type,
    parentId: obj.parentId,
    metadata: JSON.parse(JSON.stringify(obj.metadata)),
  };
}

/**
 * Capture pre-execution state relevant to the tool being called.
 */
function capturePreState(
  server: AtelierMcpServer,
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  // For remove_object: snapshot the object before it's removed
  if (toolName === "remove_object") {
    const objectId = args.objectId as string | undefined;
    if (objectId) {
      const obj = server.scene.get(objectId);
      if (obj) {
        return { object: snapshotObject(obj) };
      }
    }
    return {};
  }

  // For clear_scene: snapshot all objects
  if (toolName === "clear_scene") {
    return {
      objects: server.scene.list().map(snapshotObject),
    };
  }

  // For transform: capture the current transform so we can restore it
  if (toolName === "transform") {
    const objectId = args.objectId as string | undefined;
    if (objectId) {
      const obj = server.scene.get(objectId);
      if (obj) {
        return {
          objectId,
          previousTransform: {
            position: obj.metadata.position ?? undefined,
            rotation: obj.metadata.rotation ?? undefined,
            scale: obj.metadata.scale ?? undefined,
          },
        };
      }
    }
    return {};
  }

  // For object-targeting tools (deform, subdivide, set_material, etc.):
  // snapshot the target object
  const objectId = (args.objectId ?? args.targetId) as string | undefined;
  if (objectId) {
    const obj = server.scene.get(objectId);
    if (obj) {
      return { objectId, snapshot: snapshotObject(obj) };
    }
  }

  // For merge/smooth_merge/smooth_boolean/boolean_op: snapshot involved objects
  if (args.objectIdA || args.objectIdB) {
    const snapshots: SceneObject[] = [];
    for (const key of ["objectIdA", "objectIdB", "toolId", "targetId"]) {
      const id = args[key] as string | undefined;
      if (id) {
        const obj = server.scene.get(id);
        if (obj) snapshots.push(snapshotObject(obj));
      }
    }
    if (snapshots.length > 0) {
      return { snapshots };
    }
  }

  return {};
}

/**
 * Build the undoData from pre-state and post-execution result.
 */
function buildUndoData(
  toolName: string,
  _args: Record<string, unknown>,
  preState: Record<string, unknown>,
  result: unknown,
): Record<string, unknown> {
  const undoData: Record<string, unknown> = { ...preState };

  // For creation tools, extract the created ID from the result
  if (CREATION_TOOLS.has(toolName)) {
    const payload = extractResultPayload(result);
    if (payload?.id) {
      undoData.id = payload.id;
    }
  }

  // For scatter, extract all created IDs
  if (toolName === "scatter") {
    const payload = extractResultPayload(result);
    if (payload?.ids) {
      undoData.ids = payload.ids;
    }
  }

  // For merge/smooth_merge/smooth_boolean, extract new ID and originals info
  if (toolName === "merge" || toolName === "smooth_merge" || toolName === "smooth_boolean") {
    const payload = extractResultPayload(result);
    if (payload?.id) {
      undoData.id = payload.id;
    }
  }

  return undoData;
}

/**
 * Creates a middleware that records undo entries for mutating tool calls.
 * Insert this into the middleware chain in the server constructor.
 */
export function createUndoMiddleware(server: AtelierMcpServer): Middleware {
  return async (ctx: ToolContext, next: () => Promise<unknown>) => {
    if (!MUTATING_TOOLS.has(ctx.toolName)) {
      return next();
    }

    // Capture pre-state before the tool executes
    const preState = capturePreState(server, ctx.toolName, ctx.args);

    // Execute the tool
    const result = await next();

    // Check if the result indicates an error — don't record undo for failed calls
    if (result != null && typeof result === "object") {
      const r = result as { isError?: boolean };
      if (r.isError) {
        return result;
      }
    }

    // Build undo data from pre-state + result
    const undoData = buildUndoData(ctx.toolName, ctx.args, preState, result);

    // Push to history
    server.history.push({
      toolName: ctx.toolName,
      args: ctx.args,
      undoData,
      timestamp: Date.now(),
    });

    logger.debug("Undo entry recorded", {
      tool: ctx.toolName,
      undoCount: server.history.undoCount,
    });

    return result;
  };
}
