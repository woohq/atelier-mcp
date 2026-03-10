import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";
import { AssetLibrary } from "../../engine/asset-library.js";

export function registerLibraryTools(server: AtelierMcpServer): void {
  const library = new AssetLibrary("./assets");

  server.registry.register({
    name: "save_prefab",
    description:
      "Save an object or group as a reusable prefab to the assets directory.",
    schema: {
      name: z.string().min(1).describe("Prefab name"),
      objectId: z
        .string()
        .optional()
        .describe("ID of object/group to save. Omit to save entire scene."),
    },
    handler: async (ctx) => {
      const { name, objectId } = ctx.args;
      const allObjects = server.scene.list();

      let objectsToSave;
      if (objectId) {
        // Save specific object and its children
        const obj = server.scene.get(objectId);
        if (!obj) return makeTextResponse({ error: `Object "${objectId}" not found` });
        objectsToSave = allObjects.filter(
          (o) => o.id === objectId || o.parentId === objectId,
        );
      } else {
        objectsToSave = allObjects;
      }

      const prefab = {
        name,
        objects: objectsToSave.map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          parentId: o.parentId,
          metadata: o.metadata ?? {},
        })),
        createdAt: new Date().toISOString(),
      };

      const filePath = await library.save(name, prefab);
      return makeTextResponse({ name, objectCount: prefab.objects.length, path: filePath });
    },
  });

  server.registry.register({
    name: "load_prefab",
    description: "Load a saved prefab into the current scene.",
    schema: {
      name: z.string().min(1).describe("Prefab name to load"),
    },
    handler: async (ctx) => {
      const prefab = await library.load(ctx.args.name);
      if (!prefab) return makeTextResponse({ error: `Prefab "${ctx.args.name}" not found` });

      // Re-create objects in scene
      const idMap = new Map<string, string>();
      for (const obj of prefab.objects) {
        const newId = server.scene.generateId(obj.type);
        idMap.set(obj.id, newId);
        server.scene.create({
          id: newId,
          name: obj.name,
          type: obj.type,
          parentId: obj.parentId ? (idMap.get(obj.parentId) ?? null) : null,
          metadata: obj.metadata,
        });
        // Re-execute the creation command in the browser
        // This is a simplification — full replay would need to store the original command
        if (obj.type === "group") {
          await server.bridge.execute("createGroup", { id: newId, name: obj.name });
        }
      }

      return makeTextResponse({
        name: ctx.args.name,
        objectsLoaded: prefab.objects.length,
        note: "Prefab metadata loaded. Re-creation of geometry requires re-executing original tools.",
      });
    },
  });

  server.registry.register({
    name: "list_prefabs",
    description: "List all saved prefabs in the assets directory.",
    schema: {},
    handler: async () => {
      const names = await library.list();
      return makeTextResponse({ prefabs: names, count: names.length });
    },
  });
}
