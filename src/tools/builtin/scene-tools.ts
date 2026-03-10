import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";
import { AtelierError, ErrorCode } from "../../types/errors.js";

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export function registerSceneTools(server: AtelierMcpServer): void {
  // --- create_group ---
  server.registry.register({
    name: "create_group",
    description:
      "Create an empty group node for organizing objects. " +
      "Objects can be added to the group with add_to_group.",
    schema: {
      name: z.string().min(1).describe("Display name for the group"),
      parentId: z.string().optional().describe("Parent group ID (nests inside another group)"),
    },
    handler: async (ctx) => {
      const { name, parentId } = ctx.args;
      const id = server.scene.generateId("group");
      server.scene.create({
        id,
        name,
        type: "group",
        parentId: parentId ?? null,
      });
      if (parentId && !server.scene.get(parentId)) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Parent group "${parentId}" not found`);
      }
      await server.bridge.execute("createGroup", { id, name, parentId });
      return makeTextResponse({ id, name });
    },
  });

  // --- add_to_group ---
  server.registry.register({
    name: "add_to_group",
    description: "Move an existing object into a group.",
    schema: {
      groupId: z.string().describe("ID of the target group"),
      objectId: z.string().describe("ID of the object to move into the group"),
    },
    handler: async (ctx) => {
      const { groupId, objectId } = ctx.args;
      const group = server.scene.get(groupId);
      if (!group) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Group "${groupId}" not found`);
      }
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      server.scene.update(objectId, { parentId: groupId });
      await server.bridge.execute("addToGroup", { groupId, objectId });
      return makeTextResponse({ groupId, objectId, ok: true });
    },
  });

  // --- transform ---
  server.registry.register({
    name: "transform",
    description:
      "Set the position, rotation, and/or scale of an object. " +
      "All values are optional — only provided fields are updated.",
    schema: {
      objectId: z.string().describe("ID of the object to transform"),
      position: vec3Schema.optional().describe("New position [x, y, z]"),
      rotation: vec3Schema.optional().describe("New rotation in radians [x, y, z]"),
      scale: vec3Schema.optional().describe("New scale [x, y, z]"),
    },
    handler: async (ctx) => {
      const { objectId, position, rotation, scale } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const metadata: Record<string, unknown> = {};
      if (position) metadata.position = position;
      if (rotation) metadata.rotation = rotation;
      if (scale) metadata.scale = scale;
      server.scene.update(objectId, { metadata });
      await server.bridge.execute("transform", { objectId, position, rotation, scale });
      return makeTextResponse({ objectId, position, rotation, scale });
    },
  });

  // --- set_camera ---
  server.registry.register({
    name: "set_camera",
    description:
      "Configure the camera. Use a named preset (front, three_quarter, top_down, isometric, side) " +
      "OR provide custom position, lookAt, and fov.",
    schema: {
      preset: z
        .enum(["front", "three_quarter", "top_down", "isometric", "side"])
        .optional()
        .describe("Camera preset name"),
      position: vec3Schema.optional().describe("Custom camera position [x, y, z]"),
      lookAt: vec3Schema.optional().describe("Point to look at [x, y, z]"),
      fov: z.number().min(1).max(179).optional().describe("Field of view in degrees"),
    },
    handler: async (ctx) => {
      const { preset, position, lookAt, fov } = ctx.args;
      await server.bridge.execute("setCamera", { preset, position, lookAt, fov });
      return makeTextResponse({ preset, position, lookAt, fov });
    },
  });

  // --- set_light ---
  server.registry.register({
    name: "set_light",
    description:
      "Add a light to the scene. Types: directional (sun-like), ambient (uniform fill), " +
      "point (omni-directional from a position).",
    schema: {
      type: z.enum(["directional", "ambient", "point"]).describe("Light type"),
      color: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Light color as hex string or integer. Default white"),
      intensity: z.number().min(0).optional().describe("Light intensity. Default 1"),
      position: vec3Schema.optional().describe("Position [x, y, z] (directional, point)"),
    },
    handler: async (ctx) => {
      const { type, color, intensity, position } = ctx.args;
      const id = server.scene.generateId("light");
      server.scene.create({
        id,
        name: id,
        type: `light_${type}`,
        metadata: { lightType: type, color, intensity, position },
      });
      await server.bridge.execute("setLight", { id, type, color, intensity, position });
      return makeTextResponse({ id, type, color, intensity, position });
    },
  });

  // --- list_objects ---
  server.registry.register({
    name: "list_objects",
    description: "List all objects currently in the scene with their IDs, types, and transforms.",
    schema: {},
    handler: async () => {
      const objects = server.scene.list();
      return makeTextResponse(
        objects.map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          parentId: o.parentId,
        })),
      );
    },
  });

  // --- remove_object ---
  server.registry.register({
    name: "remove_object",
    description: "Remove an object (and its children) from the scene.",
    schema: {
      objectId: z.string().describe("ID of the object to remove"),
    },
    handler: async (ctx) => {
      const { objectId } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      server.scene.remove(objectId);
      await server.bridge.execute("removeObject", { objectId });
      return makeTextResponse({ objectId, removed: true });
    },
  });

  // --- clear_scene ---
  server.registry.register({
    name: "clear_scene",
    description: "Remove all objects from the scene, resetting it to empty.",
    schema: {},
    handler: async () => {
      server.scene.clear();
      await server.bridge.execute("clearScene", {});
      return makeTextResponse({ cleared: true });
    },
  });

  // --- set_background ---
  server.registry.register({
    name: "set_background",
    description:
      "Set the scene background color and opacity. Use color '#000000' for black, " +
      "'#ffffff' for white. Set alpha to 0 for transparent background (useful for PNG export).",
    schema: {
      color: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Background color as hex string ('#ff0000') or integer. Default white."),
      alpha: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Background opacity (0=transparent, 1=opaque). Default 1."),
    },
    handler: async (ctx) => {
      const { color, alpha } = ctx.args;
      await server.bridge.execute("setBackground", { color, alpha });
      return makeTextResponse({ color, alpha, status: "applied" });
    },
  });

  // --- set_shadow ---
  server.registry.register({
    name: "set_shadow",
    description:
      "Control shadow casting and receiving for an object. " +
      "Shadows must be enabled on lights (directional/point) to see effects.",
    schema: {
      objectId: z.string().describe("ID of the object"),
      castShadow: z.boolean().optional().describe("Whether this object casts shadows"),
      receiveShadow: z.boolean().optional().describe("Whether this object receives shadows"),
    },
    handler: async (ctx) => {
      const { objectId, castShadow, receiveShadow } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const result = await server.bridge.execute("setShadow", {
        objectId,
        castShadow,
        receiveShadow,
      });
      return makeTextResponse(result);
    },
  });

  // --- set_environment ---
  server.registry.register({
    name: "set_environment",
    description:
      "Set a procedural environment map for scene lighting and reflections. " +
      "Presets: studio (soft box lighting), neutral (even lighting), outdoor (brighter). " +
      "No external files needed — generates environment procedurally.",
    schema: {
      preset: z
        .enum(["studio", "neutral", "outdoor"])
        .default("studio")
        .describe("Environment preset"),
      intensity: z
        .number()
        .min(0)
        .max(5)
        .default(1.0)
        .describe("Environment intensity"),
      background: z
        .boolean()
        .default(false)
        .describe("Also use environment as scene background"),
    },
    handler: async (ctx) => {
      const { preset, intensity, background } = ctx.args;
      const result = await server.bridge.execute("setEnvironment", {
        preset,
        intensity,
        background,
      });
      return makeTextResponse(result);
    },
  });

  // --- save_camera ---
  server.registry.register({
    name: "save_camera",
    description: "Save the current camera position as a named bookmark for later restoration.",
    schema: {
      name: z.string().min(1).describe("Bookmark name"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("saveCamera", { name: ctx.args.name });
      return makeTextResponse(result);
    },
  });

  // --- restore_camera ---
  server.registry.register({
    name: "restore_camera",
    description: "Restore camera to a previously saved bookmark position.",
    schema: {
      name: z.string().min(1).describe("Bookmark name to restore"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("restoreCamera", { name: ctx.args.name });
      return makeTextResponse(result);
    },
  });

  // --- set_symmetry ---
  server.registry.register({
    name: "set_symmetry",
    description:
      "Toggle symmetry mode. When enabled, geometry-creating tools (create_primitive, " +
      "create_mesh, extrude, extrude_along_path) automatically create a mirrored copy " +
      "across the specified axis.",
    schema: {
      enabled: z.boolean().describe("Enable or disable symmetry"),
      axis: z
        .enum(["x", "y", "z"])
        .default("x")
        .describe("Mirror axis"),
      offset: z
        .number()
        .default(0)
        .describe("Offset from origin on the mirror axis"),
    },
    handler: async (ctx) => {
      const { enabled, axis, offset } = ctx.args;
      (server as any).symmetry.set({ enabled, axis, offset });
      return makeTextResponse({ enabled, axis, offset });
    },
  });

  // --- set_reference_image ---
  server.registry.register({
    name: "set_reference_image",
    description:
      "Place a reference image in the scene for visual comparison. " +
      'Mode "background" creates a full-screen backdrop behind the scene. ' +
      'Mode "plane" creates a positioned plane with the image texture.',
    schema: {
      imageData: z.string().describe("Base64-encoded PNG image data"),
      position: vec3Schema
        .optional()
        .describe('Position [x, y, z] for "plane" mode'),
      scale: vec3Schema
        .optional()
        .describe('Scale [x, y, z] for "plane" mode'),
      opacity: z
        .number()
        .min(0)
        .max(1)
        .default(0.5)
        .describe("Image opacity (0=transparent, 1=opaque)"),
      mode: z
        .enum(["background", "plane"])
        .default("plane")
        .describe('"background" for a full-screen backdrop, "plane" for a positioned plane'),
    },
    handler: async (ctx) => {
      const { imageData, position, scale, opacity, mode } = ctx.args;
      const id = server.scene.generateId("refimg");
      server.scene.create({
        id,
        name: id,
        type: "reference_image",
        metadata: { mode, opacity },
      });
      await server.bridge.execute("setReferenceImage", {
        id,
        imageData,
        position,
        scale,
        opacity,
        mode,
      });
      return makeTextResponse({ id, mode, opacity });
    },
  });

  // --- add_constraint ---
  server.registry.register({
    name: "add_constraint",
    description:
      "Add a constraint between two objects. " +
      "'look_at' makes the source always face the target. " +
      "'copy_transform' copies the target's transform to the source with an optional offset.",
    schema: {
      type: z
        .enum(["look_at", "copy_transform"])
        .describe("Constraint type"),
      sourceId: z.string().describe("ID of the source object (the one being constrained)"),
      targetId: z.string().describe("ID of the target object (the one being tracked/copied)"),
      offset: vec3Schema
        .optional()
        .describe("Positional offset [x, y, z] for copy_transform"),
    },
    handler: async (ctx) => {
      const { type, sourceId, targetId, offset } = ctx.args;
      const source = server.scene.get(sourceId);
      if (!source) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Source "${sourceId}" not found`);
      }
      const target = server.scene.get(targetId);
      if (!target) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Target "${targetId}" not found`);
      }
      const constraintId = server.scene.generateId("constraint");
      await server.bridge.execute("addConstraint", {
        id: constraintId,
        type,
        sourceId,
        targetId,
        offset,
      });
      return makeTextResponse({ constraintId, type, sourceId, targetId, offset });
    },
  });

  // --- remove_constraint ---
  server.registry.register({
    name: "remove_constraint",
    description: "Remove a constraint by its ID.",
    schema: {
      constraintId: z.string().describe("ID of the constraint to remove"),
    },
    handler: async (ctx) => {
      const { constraintId } = ctx.args;
      await server.bridge.execute("removeConstraint", { id: constraintId });
      return makeTextResponse({ constraintId, removed: true });
    },
  });

  // --- align_objects ---
  server.registry.register({
    name: "align_objects",
    description:
      "Align multiple objects along an axis. " +
      "'min' aligns to the smallest edge, 'center' to the average, 'max' to the largest edge.",
    schema: {
      objectIds: z
        .array(z.string())
        .min(2)
        .describe("IDs of objects to align"),
      axis: z.enum(["x", "y", "z"]).describe("Axis to align on"),
      alignment: z.enum(["min", "center", "max"]).describe("Alignment mode"),
    },
    handler: async (ctx) => {
      const { objectIds, axis, alignment } = ctx.args;
      for (const oid of objectIds) {
        if (!server.scene.get(oid)) {
          throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${oid}" not found`);
        }
      }
      const result = await server.bridge.execute("alignObjects", { objectIds, axis, alignment });
      return makeTextResponse(result);
    },
  });

  // --- distribute_objects ---
  server.registry.register({
    name: "distribute_objects",
    description:
      "Evenly distribute objects along an axis between the min and max positions.",
    schema: {
      objectIds: z
        .array(z.string())
        .min(3)
        .describe("IDs of objects to distribute"),
      axis: z.enum(["x", "y", "z"]).describe("Axis to distribute along"),
    },
    handler: async (ctx) => {
      const { objectIds, axis } = ctx.args;
      for (const oid of objectIds) {
        if (!server.scene.get(oid)) {
          throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${oid}" not found`);
        }
      }
      const result = await server.bridge.execute("distributeObjects", { objectIds, axis });
      return makeTextResponse(result);
    },
  });

  // --- snap_to_ground ---
  server.registry.register({
    name: "snap_to_ground",
    description:
      "Snap an object to the ground plane (y=0) so its bounding box bottom touches y=0.",
    schema: {
      objectId: z.string().describe("ID of the object to snap"),
    },
    handler: async (ctx) => {
      const { objectId } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const result = await server.bridge.execute("snapToGround", { objectId });
      return makeTextResponse(result);
    },
  });

  // --- render_multi_view ---
  server.registry.register({
    name: "render_multi_view",
    description:
      "Render the scene from multiple camera angles in a single grid image. " +
      "Available views: front, side, top_down, three_quarter, back, isometric.",
    schema: {
      views: z
        .array(z.string())
        .default(["front", "side", "top_down", "three_quarter"])
        .describe("View names"),
      width: z
        .number()
        .int()
        .min(64)
        .max(2048)
        .default(512)
        .describe("Width of each view cell"),
      height: z
        .number()
        .int()
        .min(64)
        .max(2048)
        .default(512)
        .describe("Height of each view cell"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("renderMultiView", ctx.args);
      const data = result as {
        image: string;
        cols: number;
        rows: number;
        views: string[];
      };
      return {
        content: [
          { type: "image" as const, data: data.image, mimeType: "image/png" as const },
          {
            type: "text" as const,
            text: JSON.stringify({ views: data.views, cols: data.cols, rows: data.rows }),
          },
        ],
      };
    },
  });
}
