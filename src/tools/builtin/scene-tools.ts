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
}
