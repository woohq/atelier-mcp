import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";
import { AtelierError, ErrorCode } from "../../types/errors.js";

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export function registerGeometryTools(server: AtelierMcpServer): void {
  // --- create_primitive ---
  server.registry.register({
    name: "create_primitive",
    description:
      "Create a 3D primitive shape (box, sphere, cylinder, cone, torus, or plane). " +
      "Returns the generated object ID. Use transform to reposition after creation.",
    schema: {
      shape: z
        .enum(["box", "sphere", "cylinder", "cone", "torus", "plane"])
        .describe("Primitive shape type"),
      width: z.number().positive().optional().describe("Width (box, plane). Default 1"),
      height: z
        .number()
        .positive()
        .optional()
        .describe("Height (box, cylinder, cone, plane). Default 1"),
      depth: z.number().positive().optional().describe("Depth (box). Default 1"),
      radius: z
        .number()
        .positive()
        .optional()
        .describe("Radius (sphere, cone, torus). Default 0.5"),
      radiusTop: z.number().min(0).optional().describe("Top radius (cylinder). Default 0.5"),
      radiusBottom: z.number().min(0).optional().describe("Bottom radius (cylinder). Default 0.5"),
      tube: z.number().positive().optional().describe("Tube radius (torus). Default 0.2"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
      rotation: vec3Schema.optional().describe("Rotation in radians [x, y, z]"),
      scale: vec3Schema.optional().describe("Scale [x, y, z]"),
      color: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Color as hex string (#ff0000) or integer"),
    },
    handler: async (ctx) => {
      const { shape, position, rotation, scale, color, ...dimensions } = ctx.args;
      const id = server.scene.generateId(shape);
      server.scene.create({
        id,
        name: id,
        type: shape,
        metadata: { position, rotation, scale, color, ...dimensions },
      });
      await server.bridge.execute("createPrimitive", {
        id,
        shape,
        position,
        rotation,
        scale,
        color,
        ...dimensions,
      });
      return makeTextResponse({ id, shape });
    },
  });

  // --- create_mesh ---
  server.registry.register({
    name: "create_mesh",
    description:
      "Create a custom mesh from raw vertex data. Provide flat arrays of vertex positions " +
      "(groups of 3 floats), optional face indices, UVs (groups of 2 floats), and normals. " +
      "Normals are computed automatically if not provided.",
    schema: {
      vertices: z
        .array(z.number())
        .min(9)
        .describe("Flat array of vertex positions [x,y,z, x,y,z, ...]"),
      faces: z.array(z.number().int().min(0)).optional().describe("Face index array (triangles)"),
      uvs: z.array(z.number()).optional().describe("Flat UV array [u,v, u,v, ...]"),
      normals: z.array(z.number()).optional().describe("Flat normals array [nx,ny,nz, ...]"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
      color: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Color as hex string (#ff0000) or integer"),
    },
    handler: async (ctx) => {
      const { vertices, faces, uvs, normals, position, color } = ctx.args;
      if (vertices.length % 3 !== 0) {
        throw new AtelierError(
          ErrorCode.INVALID_OPERATION,
          "vertices array length must be a multiple of 3",
        );
      }
      const id = server.scene.generateId("mesh");
      server.scene.create({
        id,
        name: id,
        type: "mesh",
        metadata: { vertexCount: vertices.length / 3, position, color },
      });
      await server.bridge.execute("createMesh", {
        id,
        vertices,
        faces,
        uvs,
        normals,
        position,
        color,
      });
      return makeTextResponse({ id, vertexCount: vertices.length / 3 });
    },
  });

  // --- boolean_op ---
  server.registry.register({
    name: "boolean_op",
    description:
      "Perform a boolean/CSG operation between two meshes: union, subtract, or intersect. " +
      "NOTE: Not yet implemented — returns a placeholder. Will be backed by three-bvh-csg.",
    schema: {
      targetId: z.string().describe("ID of the target (base) mesh"),
      toolId: z.string().describe("ID of the tool (cutter) mesh"),
      operation: z.enum(["union", "subtract", "intersect"]).describe("Boolean operation type"),
    },
    handler: async (ctx) => {
      const { targetId, toolId, operation } = ctx.args;
      const target = server.scene.get(targetId);
      if (!target) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${targetId}" not found`);
      }
      const tool = server.scene.get(toolId);
      if (!tool) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${toolId}" not found`);
      }
      const result = await server.bridge.execute("booleanOp", {
        targetId,
        toolId,
        operation,
      });
      return makeTextResponse({
        status: "not_yet_implemented",
        message: `Boolean ${operation} between "${targetId}" and "${toolId}" is stubbed. CSG library integration pending.`,
        ...(result as object),
      });
    },
  });

  // --- extrude ---
  server.registry.register({
    name: "extrude",
    description:
      "Extrude a 2D profile along the Z axis to create a 3D shape. " +
      "Provide a closed polygon as an array of [x, y] points and a depth.",
    schema: {
      points: z
        .array(z.tuple([z.number(), z.number()]))
        .min(3)
        .describe("2D profile points [[x,y], [x,y], ...] — at least 3 points"),
      depth: z.number().positive().describe("Extrusion depth"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
      color: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Color as hex string (#ff0000) or integer"),
    },
    handler: async (ctx) => {
      const { points, depth, position, color } = ctx.args;
      const id = server.scene.generateId("extrude");
      server.scene.create({
        id,
        name: id,
        type: "extrude",
        metadata: { pointCount: points.length, depth, position, color },
      });
      await server.bridge.execute("extrude", { id, points, depth, position, color });
      return makeTextResponse({ id, pointCount: points.length, depth });
    },
  });

  // --- deform ---
  server.registry.register({
    name: "deform",
    description:
      "Apply a deformation to an existing mesh. Types: 'noise' (random displacement), " +
      "'bend' (curve along axis), 'twist' (rotate along axis), 'taper' (scale along axis).",
    schema: {
      objectId: z.string().describe("ID of the mesh to deform"),
      type: z.enum(["bend", "twist", "taper", "noise"]).describe("Deformation type"),
      params: z
        .record(z.number())
        .optional()
        .describe(
          "Deformation params — noise: { amplitude, seed }; bend: { angle (radians), axis }; " +
            "twist: { angle (radians), axis }; taper: { factor (0-1), axis }",
        ),
    },
    handler: async (ctx) => {
      const { objectId, type, params } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const result = await server.bridge.execute("deform", { objectId, type, params });
      return makeTextResponse({
        objectId,
        deformType: type,
        ...(result as object),
      });
    },
  });

  // --- subdivide ---
  server.registry.register({
    name: "subdivide",
    description:
      "Apply Loop subdivision to smooth a mesh. Each level quadruples the face count. " +
      "Use 1-2 levels for subtle smoothing, 3-4 for very smooth results.",
    schema: {
      objectId: z.string().describe("ID of the mesh to subdivide"),
      levels: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(1)
        .describe("Subdivision levels (1-4). Each level 4x face count."),
      preserveEdges: z
        .boolean()
        .default(false)
        .describe("If true, keeps sharp edges instead of smoothing"),
    },
    handler: async (ctx) => {
      const { objectId, levels, preserveEdges } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const result = await server.bridge.execute("subdivide", {
        objectId,
        levels,
        preserveEdges,
      });
      return makeTextResponse({
        objectId,
        levels,
        ...(result as object),
      });
    },
  });
}
