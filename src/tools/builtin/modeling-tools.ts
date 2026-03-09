import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";
import { AtelierError, ErrorCode } from "../../types/errors.js";
import { SeededRNG } from "../../util/rng.js";

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export function registerModelingTools(server: AtelierMcpServer): void {
  // --- clone ---
  server.registry.register({
    name: "clone",
    description:
      "Duplicate an existing object. Returns a new independent copy with a new ID. " +
      "Optionally set position, rotation, scale on the clone.",
    schema: {
      objectId: z.string().describe("ID of the object to clone"),
      position: vec3Schema.optional().describe("Position for the clone [x, y, z]"),
      rotation: vec3Schema
        .optional()
        .describe("Rotation for the clone [x, y, z] radians"),
      scale: vec3Schema.optional().describe("Scale for the clone [x, y, z]"),
    },
    handler: async (ctx) => {
      const { objectId, position, rotation, scale } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(
          ErrorCode.OBJECT_NOT_FOUND,
          `Object "${objectId}" not found`,
        );
      }
      const newId = server.scene.generateId("clone");
      server.scene.create({
        id: newId,
        name: newId,
        type: obj.type,
        metadata: { ...obj.metadata, clonedFrom: objectId },
      });
      await server.bridge.execute("clone", {
        sourceId: objectId,
        newId,
        position,
        rotation,
        scale,
      });
      return makeTextResponse({ id: newId, clonedFrom: objectId });
    },
  });

  // --- mirror ---
  server.registry.register({
    name: "mirror",
    description:
      "Mirror (reflect) an object across an axis. Creates a new mirrored copy. " +
      "The mirror flips the scale on the chosen axis and reflects the position.",
    schema: {
      objectId: z.string().describe("ID of the object to mirror"),
      axis: z.enum(["x", "y", "z"]).describe("Axis to mirror across"),
      offset: z
        .number()
        .optional()
        .describe("Offset from origin along the mirror axis"),
    },
    handler: async (ctx) => {
      const { objectId, axis, offset } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(
          ErrorCode.OBJECT_NOT_FOUND,
          `Object "${objectId}" not found`,
        );
      }
      const newId = server.scene.generateId("mirror");
      server.scene.create({
        id: newId,
        name: newId,
        type: obj.type,
        metadata: {
          ...obj.metadata,
          mirroredFrom: objectId,
          mirrorAxis: axis,
        },
      });
      await server.bridge.execute("mirror", {
        sourceId: objectId,
        newId,
        axis,
        offset: offset ?? 0,
      });
      return makeTextResponse({ id: newId, mirroredFrom: objectId, axis });
    },
  });

  // --- create_tube ---
  server.registry.register({
    name: "create_tube",
    description:
      "Create a tube/pipe that follows a smooth spline path through 3D points. " +
      "Uses Catmull-Rom interpolation for smooth curves. " +
      "Great for wires, pipes, tentacles, paths.",
    schema: {
      points: z
        .array(vec3Schema)
        .min(2)
        .describe("Control points the tube passes through [[x,y,z], ...]"),
      radius: z.number().positive().default(0.1).describe("Tube radius"),
      segments: z
        .number()
        .int()
        .min(2)
        .default(64)
        .describe("Number of segments along the path"),
      radialSegments: z
        .number()
        .int()
        .min(3)
        .default(8)
        .describe("Number of sides around the tube"),
      closed: z
        .boolean()
        .default(false)
        .describe("Whether the tube forms a closed loop"),
      color: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Color"),
      position: vec3Schema.optional().describe("Position offset [x, y, z]"),
    },
    handler: async (ctx) => {
      const {
        points,
        radius,
        segments,
        radialSegments,
        closed,
        color,
        position,
      } = ctx.args;
      const id = server.scene.generateId("tube");
      server.scene.create({
        id,
        name: id,
        type: "tube",
        metadata: { pointCount: points.length, radius, closed },
      });
      await server.bridge.execute("createTube", {
        id,
        points,
        radius,
        segments,
        radialSegments,
        closed,
        color,
        position,
      });
      return makeTextResponse({ id, pointCount: points.length });
    },
  });

  // --- create_lathe ---
  server.registry.register({
    name: "create_lathe",
    description:
      "Create a surface of revolution by rotating a 2D profile around the Y axis. " +
      "Like a pottery wheel — define the cross-section silhouette and it spins into 3D. " +
      "Good for vases, bottles, columns, goblets.",
    schema: {
      points: z
        .array(z.tuple([z.number(), z.number()]))
        .min(2)
        .describe(
          "2D profile points [[x, y], ...] where x is distance from axis, y is height",
        ),
      segments: z
        .number()
        .int()
        .min(3)
        .default(32)
        .describe("Number of rotation segments"),
      phiLength: z
        .number()
        .min(0)
        .max(6.283185307)
        .default(6.283185307)
        .describe(
          "Rotation angle in radians (default 2\u03C0 for full revolution)",
        ),
      color: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Color"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
    },
    handler: async (ctx) => {
      const { points, segments, phiLength, color, position } = ctx.args;
      const id = server.scene.generateId("lathe");
      server.scene.create({
        id,
        name: id,
        type: "lathe",
        metadata: { pointCount: points.length, segments },
      });
      await server.bridge.execute("createLathe", {
        id,
        points,
        segments,
        phiLength,
        color,
        position,
      });
      return makeTextResponse({ id, pointCount: points.length });
    },
  });

  // --- merge ---
  server.registry.register({
    name: "merge",
    description:
      "Merge multiple meshes into a single mesh. Combines all geometry into one buffer. " +
      "Useful for optimizing scenes or creating a single exportable object. " +
      "Materials from the first object are used.",
    schema: {
      objectIds: z
        .array(z.string())
        .min(2)
        .describe("IDs of meshes to merge"),
      removeOriginals: z
        .boolean()
        .default(true)
        .describe("Remove original objects after merging"),
    },
    handler: async (ctx) => {
      const { objectIds, removeOriginals } = ctx.args;
      for (const oid of objectIds) {
        if (!server.scene.get(oid)) {
          throw new AtelierError(
            ErrorCode.OBJECT_NOT_FOUND,
            `Object "${oid}" not found`,
          );
        }
      }
      const id = server.scene.generateId("merged");
      server.scene.create({
        id,
        name: id,
        type: "mesh",
        metadata: { mergedFrom: objectIds },
      });
      await server.bridge.execute("merge", {
        objectIds,
        newId: id,
        removeOriginals,
      });
      if (removeOriginals) {
        for (const oid of objectIds) {
          server.scene.remove(oid);
        }
      }
      return makeTextResponse({
        id,
        mergedCount: objectIds.length,
        removedOriginals: removeOriginals,
      });
    },
  });

  // --- scatter ---
  server.registry.register({
    name: "scatter",
    description:
      "Scatter copies of an object within a region. Creates many clones with randomized " +
      "transforms using a seed for deterministic results. " +
      "Region types: 'box' (center + size) or 'sphere' (center + radius).",
    schema: {
      sourceId: z.string().describe("ID of the object to scatter"),
      count: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .describe("Number of copies to create"),
      region: z
        .object({
          type: z.enum(["box", "sphere"]).describe("Region shape"),
          center: vec3Schema
            .default([0, 0, 0])
            .describe("Region center [x, y, z]"),
          size: vec3Schema
            .optional()
            .describe("Box half-extents [x, y, z] (for box region)"),
          radius: z
            .number()
            .positive()
            .optional()
            .describe("Sphere radius (for sphere region)"),
        })
        .describe("Scatter region"),
      scaleVariation: z
        .number()
        .min(0)
        .max(1)
        .default(0)
        .describe("Scale randomness (0=uniform, 1=max variation)"),
      rotationVariation: z
        .number()
        .min(0)
        .max(1)
        .default(0)
        .describe(
          "Rotation randomness around Y axis (0=none, 1=full)",
        ),
      seed: z
        .number()
        .int()
        .default(42)
        .describe("Random seed for deterministic results"),
    },
    handler: async (ctx) => {
      const {
        sourceId,
        count,
        region,
        scaleVariation,
        rotationVariation,
        seed,
      } = ctx.args;
      const obj = server.scene.get(sourceId);
      if (!obj) {
        throw new AtelierError(
          ErrorCode.OBJECT_NOT_FOUND,
          `Object "${sourceId}" not found`,
        );
      }

      // Pre-compute all transforms on server side using seeded RNG
      const rng = new SeededRNG(seed);
      const instances: Array<{
        id: string;
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
      }> = [];

      for (let i = 0; i < count; i++) {
        let px: number, py: number, pz: number;
        if (region.type === "box") {
          const s = region.size ?? [5, 0, 5];
          px = region.center[0] + rng.range(-s[0], s[0]);
          py = region.center[1] + rng.range(-s[1], s[1]);
          pz = region.center[2] + rng.range(-s[2], s[2]);
        } else {
          const r = region.radius ?? 5;
          const theta = rng.range(0, Math.PI * 2);
          const phi = Math.acos(rng.range(-1, 1));
          const dist = r * Math.cbrt(rng.next());
          px = region.center[0] + dist * Math.sin(phi) * Math.cos(theta);
          py = region.center[1] + dist * Math.cos(phi);
          pz = region.center[2] + dist * Math.sin(phi) * Math.sin(theta);
        }

        const ry =
          rotationVariation > 0
            ? rng.range(0, Math.PI * 2) * rotationVariation
            : 0;
        const sv =
          scaleVariation > 0
            ? 1 + rng.range(-scaleVariation, scaleVariation) * 0.5
            : 1;
        const instanceId = server.scene.generateId("scatter");

        server.scene.create({
          id: instanceId,
          name: instanceId,
          type: obj.type,
          metadata: { scatteredFrom: sourceId, seed },
        });

        instances.push({
          id: instanceId,
          position: [px, py, pz],
          rotation: [0, ry, 0],
          scale: [sv, sv, sv],
        });
      }

      await server.bridge.execute("scatter", { sourceId, instances });
      return makeTextResponse({
        sourceId,
        count: instances.length,
        ids: instances.map((i) => i.id),
        seed,
      });
    },
  });
}
