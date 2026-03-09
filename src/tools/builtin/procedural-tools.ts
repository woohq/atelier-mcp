import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export function registerProceduralTools(server: AtelierMcpServer): void {
  // --- generate_tree ---
  server.registry.register({
    name: "generate_tree",
    description:
      "Generate a procedural tree. Styles: 'oak' (round canopy), 'pine' (conical), " +
      "'willow' (drooping branches), 'palm' (crown top). Adjust height, branch depth, " +
      "leaf density for variation. Seed controls randomness deterministically.",
    schema: {
      style: z
        .enum(["oak", "pine", "willow", "palm"])
        .default("oak")
        .describe("Tree style"),
      height: z.number().positive().default(3).describe("Total tree height"),
      trunkRadius: z.number().positive().default(0.15).describe("Trunk radius at base"),
      branchDepth: z
        .number()
        .int()
        .min(0)
        .max(5)
        .default(2)
        .describe("Branch recursion depth"),
      branchAngle: z
        .number()
        .min(0)
        .max(1.57)
        .default(0.5)
        .describe("Branch spread angle (radians)"),
      branchLengthFactor: z
        .number()
        .min(0.1)
        .max(1)
        .default(0.7)
        .describe("Branch length relative to parent"),
      leafDensity: z.number().min(0).max(1).default(0.6).describe("Foliage density"),
      leafSize: z.number().positive().default(0.3).describe("Individual leaf/cluster size"),
      seed: z.number().int().default(42).describe("Random seed"),
      trunkColor: z
        .union([z.string(), z.number().int()])
        .default("#8B4513")
        .describe("Trunk color"),
      leafColor: z
        .union([z.string(), z.number().int()])
        .default("#228B22")
        .describe("Leaf color"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
    },
    handler: async (ctx) => {
      const groupId = server.scene.generateId("tree");
      server.scene.create({
        id: groupId,
        name: groupId,
        type: "group",
        metadata: { generator: "tree", ...ctx.args },
      });
      const result = await server.bridge.execute("generateTree", {
        groupId,
        ...ctx.args,
      });
      const partCount = (result as any)?.partCount ?? 0;
      return makeTextResponse({ groupId, style: ctx.args.style, partCount });
    },
  });

  // --- generate_terrain ---
  server.registry.register({
    name: "generate_terrain",
    description:
      "Generate a heightmap terrain using multi-octave noise. " +
      "Resolution controls vertex density (4-256). " +
      "colorByHeight maps altitude bands to colors (water->sand->grass->rock->snow).",
    schema: {
      width: z.number().positive().default(10).describe("Terrain width"),
      depth: z.number().positive().default(10).describe("Terrain depth"),
      resolution: z
        .number()
        .int()
        .min(4)
        .max(256)
        .default(64)
        .describe("Grid resolution (vertices per side)"),
      amplitude: z.number().positive().default(2).describe("Maximum height"),
      octaves: z
        .number()
        .int()
        .min(1)
        .max(8)
        .default(4)
        .describe("Noise octaves (detail levels)"),
      lacunarity: z
        .number()
        .min(1)
        .max(4)
        .default(2)
        .describe("Frequency multiplier per octave"),
      persistence: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Amplitude multiplier per octave"),
      seed: z.number().int().default(42).describe("Random seed"),
      colorByHeight: z.boolean().default(true).describe("Color vertices by altitude"),
      heightColors: z
        .array(
          z.object({
            threshold: z.number().describe("Normalized height threshold (0-1)"),
            color: z.string().describe("Color hex string"),
          }),
        )
        .optional()
        .describe("Custom height-to-color mapping. Default: water/sand/grass/rock/snow"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
    },
    handler: async (ctx) => {
      const id = server.scene.generateId("terrain");
      server.scene.create({
        id,
        name: id,
        type: "mesh",
        metadata: { generator: "terrain", ...ctx.args },
      });
      const result = await server.bridge.execute("generateTerrain", {
        id,
        ...ctx.args,
      });
      return makeTextResponse({
        id,
        resolution: ctx.args.resolution,
        vertexCount: (result as any)?.vertexCount,
      });
    },
  });

  // --- generate_rock ---
  server.registry.register({
    name: "generate_rock",
    description:
      "Generate a procedural rock/boulder. Uses noise displacement on a sphere " +
      "with non-uniform scaling for organic shapes. Use flatShading for low-poly look.",
    schema: {
      radius: z.number().positive().default(0.5).describe("Base radius"),
      roughness: z
        .number()
        .min(0)
        .max(1)
        .default(0.4)
        .describe("Surface roughness (noise amplitude)"),
      seed: z.number().int().default(42).describe("Random seed"),
      segments: z
        .number()
        .int()
        .min(4)
        .max(64)
        .default(16)
        .describe("Geometry segments"),
      color: z
        .union([z.string(), z.number().int()])
        .default("#888888")
        .describe("Rock color"),
      flatShading: z
        .boolean()
        .default(true)
        .describe("Use flat shading for faceted look"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
    },
    handler: async (ctx) => {
      const id = server.scene.generateId("rock");
      server.scene.create({
        id,
        name: id,
        type: "mesh",
        metadata: { generator: "rock", ...ctx.args },
      });
      await server.bridge.execute("generateRock", { id, ...ctx.args });
      return makeTextResponse({ id });
    },
  });

  // --- generate_building ---
  server.registry.register({
    name: "generate_building",
    description:
      "Generate a simple building with walls, windows, and roof. " +
      "Roof styles: 'flat', 'gabled' (triangular), 'hip' (four-sided pyramid). " +
      "Windows are surface-mounted planes (no CSG needed).",
    schema: {
      width: z.number().positive().default(3).describe("Building width"),
      depth: z.number().positive().default(3).describe("Building depth"),
      floors: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(2)
        .describe("Number of floors"),
      floorHeight: z.number().positive().default(1.2).describe("Height per floor"),
      roofStyle: z
        .enum(["flat", "gabled", "hip"])
        .default("gabled")
        .describe("Roof shape"),
      windowPattern: z
        .object({
          rows: z.number().int().min(0).default(2).describe("Window rows per floor"),
          cols: z
            .number()
            .int()
            .min(0)
            .default(3)
            .describe("Window columns per wall"),
          width: z.number().positive().default(0.3).describe("Window width"),
          height: z.number().positive().default(0.4).describe("Window height"),
          inset: z
            .number()
            .min(0)
            .default(0.02)
            .describe("Window inset from wall surface"),
        })
        .default({})
        .describe("Window layout"),
      wallColor: z
        .union([z.string(), z.number().int()])
        .default("#D2B48C")
        .describe("Wall color"),
      windowColor: z
        .union([z.string(), z.number().int()])
        .default("#87CEEB")
        .describe("Window color"),
      roofColor: z
        .union([z.string(), z.number().int()])
        .default("#8B0000")
        .describe("Roof color"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
      seed: z.number().int().default(42).describe("Random seed"),
    },
    handler: async (ctx) => {
      const groupId = server.scene.generateId("building");
      server.scene.create({
        id: groupId,
        name: groupId,
        type: "group",
        metadata: { generator: "building", ...ctx.args },
      });
      const result = await server.bridge.execute("generateBuilding", {
        groupId,
        ...ctx.args,
      });
      return makeTextResponse({
        groupId,
        floors: ctx.args.floors,
        roofStyle: ctx.args.roofStyle,
        partCount: (result as any)?.partCount,
      });
    },
  });
}
