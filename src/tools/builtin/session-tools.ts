import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";
import { saveSessionToFile, loadSessionFromFile } from "../../engine/session.js";

export function registerSessionTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "save_session",
    description:
      "Save the current scene state (objects, palettes, effects, shaders) to a JSON file. " +
      "Use this to checkpoint your work and restore it later.",
    schema: {
      path: z.string().describe("File path to save the session JSON"),
    },
    handler: async (ctx) => {
      const { path } = ctx.args;
      await saveSessionToFile(path, server.scene, server.palettes, server.shaders);
      return makeTextResponse({
        saved: path,
        objects: server.scene.count(),
        effects: server.shaders.effectCount(),
      });
    },
  });

  server.registry.register({
    name: "load_session",
    description:
      "Load a previously saved session from a JSON file. " +
      "Restores all objects, palettes, and effects. Clears the current scene first.",
    schema: {
      path: z.string().describe("File path to the session JSON"),
    },
    handler: async (ctx) => {
      const { path } = ctx.args;
      const data = await loadSessionFromFile(path, server.scene, server.palettes, server.shaders);

      // Replay objects into the preview page
      for (const obj of data.objects) {
        if (obj.type === "group") {
          await server.bridge.execute("createGroup", {
            id: obj.id,
            parentId: obj.parentId,
          });
        } else {
          await server.bridge.execute("createPrimitive", {
            id: obj.id,
            shape: obj.type,
            parentId: obj.parentId,
            ...obj.metadata,
          });
        }
      }

      // Replay effects
      for (const effect of data.effects) {
        await server.bridge.execute("applyPostProcess", {
          id: effect.id,
          type: effect.type,
          ...effect.params,
        });
      }

      return makeTextResponse({
        loaded: path,
        objects: data.objects.length,
        palettes: data.palettes.length,
        effects: data.effects.length,
      });
    },
  });

  server.registry.register({
    name: "undo",
    description:
      "Undo the last scene modification. " +
      "Supports undoing object creation, removal, and transforms.",
    schema: {},
    handler: async () => {
      const record = server.history.popUndo();
      if (!record) {
        return makeTextResponse({ message: "Nothing to undo" });
      }

      // Execute the undo based on the original tool
      switch (record.toolName) {
        case "create_primitive":
        case "create_mesh":
        case "create_group":
        case "extrude":
          // Undo creation = remove the object
          if (record.undoData.id) {
            server.scene.remove(record.undoData.id as string);
            await server.bridge.execute("removeObject", {
              objectId: record.undoData.id,
            });
          }
          break;

        case "remove_object":
          // Undo removal = re-create the object
          if (record.undoData.object) {
            const obj = record.undoData.object as {
              id: string;
              name: string;
              type: string;
              parentId: string | null;
              metadata: Record<string, unknown>;
            };
            server.scene.create(obj);
            await server.bridge.execute("createPrimitive", {
              id: obj.id,
              shape: obj.type,
              ...obj.metadata,
            });
          }
          break;

        case "transform":
          // Undo transform = restore previous transform
          if (record.undoData.previousTransform) {
            const prev = record.undoData.previousTransform as Record<string, unknown>;
            await server.bridge.execute("transform", {
              objectId: record.undoData.objectId,
              ...prev,
            });
          }
          break;

        case "clear_scene":
          // Undo clear = restore all objects
          if (record.undoData.objects) {
            const objects = record.undoData.objects as Array<{
              id: string;
              name: string;
              type: string;
              parentId: string | null;
              metadata: Record<string, unknown>;
            }>;
            for (const obj of objects) {
              server.scene.create(obj);
              await server.bridge.execute("createPrimitive", {
                id: obj.id,
                shape: obj.type,
                ...obj.metadata,
              });
            }
          }
          break;

        default:
          return makeTextResponse({
            message: `Cannot undo "${record.toolName}" — not supported`,
          });
      }

      return makeTextResponse({
        undone: record.toolName,
        canUndo: server.history.canUndo(),
        canRedo: server.history.canRedo(),
      });
    },
  });

  server.registry.register({
    name: "redo",
    description: "Redo the last undone action.",
    schema: {},
    handler: async (_ctx) => {
      const record = server.history.popRedo();
      if (!record) {
        return makeTextResponse({ message: "Nothing to redo" });
      }

      // Re-execute the original tool args through the bridge
      const tool = server.registry.get(record.toolName);
      if (tool) {
        await tool.handler({ toolName: record.toolName, args: record.args });
      }

      return makeTextResponse({
        redone: record.toolName,
        canUndo: server.history.canUndo(),
        canRedo: server.history.canRedo(),
      });
    },
  });
}
