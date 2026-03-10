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
      "The target mesh is modified in place and the tool mesh is removed from the scene.",
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
      // Remove tool from scene graph
      server.scene.remove(toolId);
      return makeTextResponse({
        targetId,
        operation,
        toolRemoved: toolId,
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

  // --- extrude_along_path ---
  server.registry.register({
    name: "extrude_along_path",
    description:
      "Extrude a 2D profile along a 3D spline path. Creates organic shapes like " +
      "tentacles, horns, pipes with variable cross-section. Supports twist and scale variation.",
    schema: {
      profile: z
        .array(z.tuple([z.number(), z.number()]))
        .min(3)
        .describe("2D profile points [[x,y], ...] defining the cross-section shape"),
      path: z
        .array(z.tuple([z.number(), z.number(), z.number()]))
        .min(2)
        .describe("3D path points [[x,y,z], ...] the profile is extruded along"),
      segments: z.number().int().min(2).default(64).describe("Number of segments along the path"),
      closed: z.boolean().default(false).describe("Whether the path forms a closed loop"),
      scalePath: z
        .array(z.number().positive())
        .optional()
        .describe("Scale values along the path (interpolated). E.g. [1, 0.5] tapers to half."),
      twistAngle: z
        .number()
        .optional()
        .describe("Total twist angle in radians applied along the path"),
      color: z.union([z.string(), z.number().int()]).optional().describe("Color"),
      position: vec3Schema.optional().describe("Position [x,y,z]"),
    },
    handler: async (ctx) => {
      const { profile, path, segments, closed, scalePath, twistAngle, color, position } = ctx.args;
      const id = server.scene.generateId("pathextrude");
      server.scene.create({
        id,
        name: id,
        type: "pathextrude",
        metadata: { profilePoints: profile.length, pathPoints: path.length },
      });
      const result = await server.bridge.execute("extrudeAlongPath", {
        id,
        profile,
        path,
        segments,
        closed,
        scalePath,
        twistAngle,
        color,
        position,
      });
      return makeTextResponse({ id, ...(result as object) });
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

  // --- get_vertices ---
  server.registry.register({
    name: "get_vertices",
    description:
      "Read vertex positions from a mesh. Returns an array of [x,y,z] positions. " +
      "Use start/count for pagination on large meshes.",
    schema: {
      objectId: z.string().describe("ID of the mesh"),
      start: z.number().int().min(0).optional().describe("Start vertex index (default 0)"),
      count: z.number().int().min(1).optional().describe("Number of vertices to read (default all)"),
    },
    handler: async (ctx) => {
      const { objectId, start, count } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj)
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      const result = await server.bridge.execute("getVertices", { objectId, start, count });
      return makeTextResponse(result);
    },
  });

  // --- set_vertices ---
  server.registry.register({
    name: "set_vertices",
    description:
      "Write vertex positions to a mesh. Provide a flat array of positions [x,y,z,...] " +
      "and optionally an indices array to update specific vertices only.",
    schema: {
      objectId: z.string().describe("ID of the mesh"),
      positions: z.array(z.number()).describe("Flat array of positions [x,y,z, x,y,z, ...]"),
      indices: z
        .array(z.number().int().min(0))
        .optional()
        .describe("Vertex indices to update (partial update)"),
    },
    handler: async (ctx) => {
      const { objectId, positions, indices } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj)
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      const result = await server.bridge.execute("setVertices", { objectId, positions, indices });
      return makeTextResponse(result);
    },
  });

  // --- push_pull ---
  server.registry.register({
    name: "push_pull",
    description:
      "Move vertices along their normals (inflate/deflate). Select vertices by: " +
      "'all', specific indices, sphere region (with falloff), or box region.",
    schema: {
      objectId: z.string().describe("ID of the mesh"),
      distance: z.number().describe("Distance to push (positive) or pull (negative) along normals"),
      selection: z
        .enum(["all", "indices", "sphere", "box"])
        .default("all")
        .describe("Selection mode"),
      indices: z
        .array(z.number().int().min(0))
        .optional()
        .describe("Vertex indices (when selection='indices')"),
      sphere: z
        .object({
          center: z.tuple([z.number(), z.number(), z.number()]),
          radius: z.number().positive(),
        })
        .optional()
        .describe("Sphere selection region"),
      box: z
        .object({
          min: z.tuple([z.number(), z.number(), z.number()]),
          max: z.tuple([z.number(), z.number(), z.number()]),
        })
        .optional()
        .describe("Box selection region"),
      falloff: z
        .enum(["linear", "smooth", "sharp"])
        .default("linear")
        .describe("Falloff curve for sphere selection"),
    },
    handler: async (ctx) => {
      const { objectId, ...rest } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj)
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      const result = await server.bridge.execute("pushPull", { objectId, ...rest });
      return makeTextResponse(result);
    },
  });

  // --- smooth_merge ---
  server.registry.register({
    name: "smooth_merge",
    description:
      "Merge two meshes with Laplacian smoothing near the intersection zone. " +
      "Fast approximation of organic blending — good for joining body parts, terrain features.",
    schema: {
      objectIdA: z.string().describe("First mesh ID"),
      objectIdB: z.string().describe("Second mesh ID"),
      smoothRadius: z
        .number()
        .positive()
        .default(0.5)
        .describe("Radius of smoothing zone around intersection"),
      iterations: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(3)
        .describe("Smoothing iterations"),
      removeOriginals: z
        .boolean()
        .default(true)
        .describe("Remove original meshes after merge"),
    },
    handler: async (ctx) => {
      const { objectIdA, objectIdB, smoothRadius, iterations, removeOriginals } = ctx.args;
      for (const oid of [objectIdA, objectIdB]) {
        if (!server.scene.get(oid))
          throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${oid}" not found`);
      }
      const newId = server.scene.generateId("smoothmerge");
      server.scene.create({
        id: newId,
        name: newId,
        type: "mesh",
        metadata: { smoothMerge: true },
      });
      const result = await server.bridge.execute("smoothMerge", {
        objectIdA,
        objectIdB,
        newId,
        smoothRadius,
        iterations,
        removeOriginals,
      });
      if (removeOriginals) {
        server.scene.remove(objectIdA);
        server.scene.remove(objectIdB);
      }
      return makeTextResponse({ id: newId, ...(result as object) });
    },
  });

  // --- smooth_boolean ---
  server.registry.register({
    name: "smooth_boolean",
    description:
      "SDF-based boolean with smooth blending. Creates organic merged shapes " +
      "using marching cubes surface extraction. Slower but produces smooth, organic results.",
    schema: {
      objectIdA: z.string().describe("First mesh ID"),
      objectIdB: z.string().describe("Second mesh ID"),
      operation: z
        .enum(["union", "subtract", "intersect"])
        .default("union")
        .describe("Boolean operation"),
      smoothness: z
        .number()
        .min(0)
        .max(2)
        .default(0.3)
        .describe("Blend smoothness (higher = smoother blend)"),
      resolution: z
        .number()
        .int()
        .min(16)
        .max(128)
        .default(32)
        .describe("Grid resolution for SDF evaluation"),
      removeOriginals: z.boolean().default(true).describe("Remove original meshes"),
    },
    handler: async (ctx) => {
      const { objectIdA, objectIdB, operation, smoothness, resolution, removeOriginals } =
        ctx.args;
      for (const oid of [objectIdA, objectIdB]) {
        if (!server.scene.get(oid))
          throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${oid}" not found`);
      }
      const newId = server.scene.generateId("sdfblend");
      server.scene.create({
        id: newId,
        name: newId,
        type: "mesh",
        metadata: { sdfBlend: true, operation },
      });
      const result = await server.bridge.execute("smoothBoolean", {
        objectIdA,
        objectIdB,
        newId,
        operation,
        smoothness,
        resolution,
        removeOriginals,
      });
      if (removeOriginals) {
        server.scene.remove(objectIdA);
        server.scene.remove(objectIdB);
      }
      return makeTextResponse({ id: newId, ...(result as object) });
    },
  });

  // --- create_morph_target ---
  server.registry.register({
    name: "create_morph_target",
    description:
      "Create a morph target (blend shape) on a mesh. Provide vertex deltas to define " +
      "the target shape. Use set_morph_influence to blend between base and target shapes.",
    schema: {
      objectId: z.string().describe("ID of the mesh to add the morph target to"),
      targetName: z.string().describe("Name for this morph target"),
      deltas: z
        .array(
          z.object({
            index: z.number().int().min(0).describe("Vertex index"),
            dx: z.number().describe("X displacement"),
            dy: z.number().describe("Y displacement"),
            dz: z.number().describe("Z displacement"),
          }),
        )
        .min(1)
        .describe("Array of vertex deltas {index, dx, dy, dz}"),
    },
    handler: async (ctx) => {
      const { objectId, targetName, deltas } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const result = await server.bridge.execute("createMorphTarget", {
        objectId,
        targetName,
        deltas,
      });
      return makeTextResponse(result);
    },
  });

  // --- set_morph_influence ---
  server.registry.register({
    name: "set_morph_influence",
    description:
      "Set the influence (0-1) of a morph target on a mesh. " +
      "0 = base shape, 1 = fully morphed to target shape.",
    schema: {
      objectId: z.string().describe("ID of the mesh"),
      targetName: z.string().describe("Name of the morph target"),
      influence: z
        .number()
        .min(0)
        .max(1)
        .describe("Influence value (0 = base shape, 1 = full morph)"),
    },
    handler: async (ctx) => {
      const { objectId, targetName, influence } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const result = await server.bridge.execute("setMorphInfluence", {
        objectId,
        targetName,
        influence,
      });
      return makeTextResponse(result);
    },
  });

  // --- create_curve ---
  server.registry.register({
    name: "create_curve",
    description:
      "Create a spline/curve object. Supports CatmullRom (smooth through points) or " +
      "Bezier (4 control points). Optionally visualize as a tube with a given radius, " +
      "or as a thin line. Use sample_curve to query positions and curve_to_mesh to convert.",
    schema: {
      type: z
        .enum(["catmullrom", "bezier"])
        .default("catmullrom")
        .describe("Curve type"),
      points: z
        .array(z.tuple([z.number(), z.number(), z.number()]))
        .min(2)
        .describe("Control points [[x,y,z], ...]"),
      closed: z.boolean().default(false).describe("Whether the curve forms a closed loop"),
      tension: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Tension for CatmullRom curves (0 = loose, 1 = tight)"),
      radius: z
        .number()
        .min(0)
        .optional()
        .describe("If > 0, visualize as a tube with this radius"),
      tubularSegments: z
        .number()
        .int()
        .min(3)
        .optional()
        .describe("Number of segments along the curve"),
    },
    handler: async (ctx) => {
      const { type, points, closed, tension, radius, tubularSegments } = ctx.args;
      const id = server.scene.generateId("curve");
      server.scene.create({
        id,
        name: id,
        type: "curve",
        metadata: { curveType: type, pointCount: points.length, closed },
      });
      const result = await server.bridge.execute("createCurve", {
        id,
        type,
        points,
        closed,
        tension,
        radius,
        tubularSegments,
      });
      return makeTextResponse({ id, ...(result as object) });
    },
  });

  // --- sample_curve ---
  server.registry.register({
    name: "sample_curve",
    description:
      "Sample a point and tangent on a curve at parameter t (0-1).",
    schema: {
      objectId: z.string().describe("ID of the curve"),
      t: z.number().min(0).max(1).describe("Parameter along the curve (0 = start, 1 = end)"),
    },
    handler: async (ctx) => {
      const { objectId, t } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Curve "${objectId}" not found`);
      }
      const result = await server.bridge.execute("sampleCurve", { id: objectId, t });
      return makeTextResponse(result);
    },
  });

  // --- curve_to_mesh ---
  server.registry.register({
    name: "curve_to_mesh",
    description:
      "Convert a curve into a solid tube mesh with configurable radius and segments.",
    schema: {
      objectId: z.string().describe("ID of the curve to convert"),
      radius: z.number().positive().default(0.1).describe("Tube radius"),
      segments: z.number().int().min(3).default(64).describe("Segments along the tube"),
      radialSegments: z.number().int().min(3).default(8).describe("Segments around circumference"),
    },
    handler: async (ctx) => {
      const { objectId, radius, segments, radialSegments } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Curve "${objectId}" not found`);
      }
      const newId = server.scene.generateId("tubemesh");
      server.scene.create({
        id: newId,
        name: newId,
        type: "mesh",
        metadata: { fromCurve: objectId, radius },
      });
      const result = await server.bridge.execute("curveToMesh", {
        id: objectId,
        newId,
        radius,
        segments,
        radialSegments,
      });
      return makeTextResponse({ id: newId, ...(result as object) });
    },
  });

  // --- create_text ---
  server.registry.register({
    name: "create_text",
    description:
      "Create 3D text geometry. Loads a default font and creates extruded text.",
    schema: {
      text: z.string().min(1).describe("The text string to render"),
      size: z.number().positive().default(1).describe("Font size"),
      depth: z.number().positive().default(0.2).describe("Extrusion depth"),
      bevelEnabled: z.boolean().default(false).describe("Enable bevel on text edges"),
    },
    handler: async (ctx) => {
      const { text, size, depth, bevelEnabled } = ctx.args;
      const id = server.scene.generateId("text");
      server.scene.create({
        id,
        name: id,
        type: "text",
        metadata: { text, size, depth, bevelEnabled },
      });
      await server.bridge.execute("createText", { id, text, size, depth, bevelEnabled });
      return makeTextResponse({ id, text });
    },
  });

  // --- analyze_mesh ---
  server.registry.register({
    name: "analyze_mesh",
    description:
      "Analyze a mesh and return geometry statistics: vertex count, face count, " +
      "bounding box, surface area, and whether it has normals and UVs.",
    schema: {
      objectId: z.string().describe("ID of the mesh to analyze"),
    },
    handler: async (ctx) => {
      const { objectId } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const result = await server.bridge.execute("analyzeMesh", { objectId });
      return makeTextResponse(result);
    },
  });
}
