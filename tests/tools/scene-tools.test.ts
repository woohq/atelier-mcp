import { describe, it, expect, vi, beforeEach } from "vitest";
import { SceneEngine } from "../../src/engine/scene-engine.js";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { registerSceneTools } from "../../src/tools/builtin/scene-tools.js";

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

function createMockServer() {
  const scene = new SceneEngine();
  const registry = new ToolRegistry();
  const bridge = { execute: vi.fn().mockResolvedValue({ ok: true }), getScreenshot: vi.fn() };
  const server = { scene, registry, bridge } as any;
  registerSceneTools(server);
  return { server, scene, registry, bridge };
}

describe("Scene Tools", () => {
  let _server: any;
  let scene: SceneEngine;
  let registry: ToolRegistry;
  let bridge: any;

  beforeEach(() => {
    ({ server: _server, scene, registry, bridge } = createMockServer());
  });

  describe("create_group", () => {
    it("registers the tool", () => {
      expect(registry.has("create_group")).toBe(true);
    });

    it("creates a group", async () => {
      const tool = registry.get("create_group")!;
      const result = await tool.handler({
        toolName: "create_group",
        args: { name: "My Group" },
      });
      const data = parseResult(result);
      expect(data.id).toMatch(/^group_/);
      expect(data.name).toBe("My Group");
      expect(scene.count()).toBe(1);
      expect(scene.get(data.id)?.type).toBe("group");
      expect(bridge.execute).toHaveBeenCalledWith(
        "createGroup",
        expect.objectContaining({ name: "My Group" }),
      );
    });

    it("throws when parent does not exist", async () => {
      const tool = registry.get("create_group")!;
      await expect(
        tool.handler({
          toolName: "create_group",
          args: { name: "Child", parentId: "nonexistent" },
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("add_to_group", () => {
    it("registers the tool", () => {
      expect(registry.has("add_to_group")).toBe(true);
    });

    it("adds an object to a group", async () => {
      scene.create({ id: "grp_1", name: "Group", type: "group" });
      scene.create({ id: "box_1", name: "Box", type: "box" });

      const tool = registry.get("add_to_group")!;
      const result = await tool.handler({
        toolName: "add_to_group",
        args: { groupId: "grp_1", objectId: "box_1" },
      });
      const data = parseResult(result);
      expect(data.ok).toBe(true);
      expect(scene.get("box_1")?.parentId).toBe("grp_1");
      expect(bridge.execute).toHaveBeenCalledWith("addToGroup", {
        groupId: "grp_1",
        objectId: "box_1",
      });
    });

    it("throws when group not found", async () => {
      scene.create({ id: "box_1", name: "Box", type: "box" });
      const tool = registry.get("add_to_group")!;
      await expect(
        tool.handler({
          toolName: "add_to_group",
          args: { groupId: "missing", objectId: "box_1" },
        }),
      ).rejects.toThrow("not found");
    });

    it("throws when object not found", async () => {
      scene.create({ id: "grp_1", name: "Group", type: "group" });
      const tool = registry.get("add_to_group")!;
      await expect(
        tool.handler({
          toolName: "add_to_group",
          args: { groupId: "grp_1", objectId: "missing" },
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("transform", () => {
    it("registers the tool", () => {
      expect(registry.has("transform")).toBe(true);
    });

    it("updates position, rotation, and scale", async () => {
      scene.create({ id: "obj_1", name: "Obj", type: "box" });

      const tool = registry.get("transform")!;
      const result = await tool.handler({
        toolName: "transform",
        args: {
          objectId: "obj_1",
          position: [1, 2, 3],
          rotation: [0.1, 0.2, 0.3],
          scale: [2, 2, 2],
        },
      });
      const data = parseResult(result);
      expect(data.objectId).toBe("obj_1");
      expect(data.position).toEqual([1, 2, 3]);

      // Verify metadata was updated on scene engine
      const obj = scene.get("obj_1")!;
      expect(obj.metadata.position).toEqual([1, 2, 3]);
      expect(obj.metadata.rotation).toEqual([0.1, 0.2, 0.3]);
      expect(obj.metadata.scale).toEqual([2, 2, 2]);

      expect(bridge.execute).toHaveBeenCalledWith("transform", {
        objectId: "obj_1",
        position: [1, 2, 3],
        rotation: [0.1, 0.2, 0.3],
        scale: [2, 2, 2],
      });
    });

    it("throws when object not found", async () => {
      const tool = registry.get("transform")!;
      await expect(
        tool.handler({
          toolName: "transform",
          args: { objectId: "missing", position: [0, 0, 0] },
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("set_camera", () => {
    it("registers the tool", () => {
      expect(registry.has("set_camera")).toBe(true);
    });

    it("sets camera with preset", async () => {
      const tool = registry.get("set_camera")!;
      const result = await tool.handler({
        toolName: "set_camera",
        args: { preset: "isometric" },
      });
      const data = parseResult(result);
      expect(data.preset).toBe("isometric");
      expect(bridge.execute).toHaveBeenCalledWith(
        "setCamera",
        expect.objectContaining({ preset: "isometric" }),
      );
    });

    it("sets camera with custom position and lookAt", async () => {
      const tool = registry.get("set_camera")!;
      await tool.handler({
        toolName: "set_camera",
        args: { position: [10, 5, 10], lookAt: [0, 0, 0], fov: 60 },
      });
      expect(bridge.execute).toHaveBeenCalledWith("setCamera", {
        position: [10, 5, 10],
        lookAt: [0, 0, 0],
        fov: 60,
        preset: undefined,
      });
    });
  });

  describe("set_light", () => {
    it("registers the tool", () => {
      expect(registry.has("set_light")).toBe(true);
    });

    it("creates a directional light", async () => {
      const tool = registry.get("set_light")!;
      const result = await tool.handler({
        toolName: "set_light",
        args: {
          type: "directional",
          color: "#ffffff",
          intensity: 2,
          position: [5, 10, 5],
        },
      });
      const data = parseResult(result);
      expect(data.id).toMatch(/^light_/);
      expect(data.type).toBe("directional");
      expect(scene.count()).toBe(1);
      expect(bridge.execute).toHaveBeenCalledWith(
        "setLight",
        expect.objectContaining({ type: "directional", intensity: 2 }),
      );
    });

    it("creates an ambient light", async () => {
      const tool = registry.get("set_light")!;
      const result = await tool.handler({
        toolName: "set_light",
        args: { type: "ambient", intensity: 0.5 },
      });
      const data = parseResult(result);
      expect(data.type).toBe("ambient");
    });
  });

  describe("list_objects", () => {
    it("registers the tool", () => {
      expect(registry.has("list_objects")).toBe(true);
    });

    it("returns empty array for empty scene", async () => {
      const tool = registry.get("list_objects")!;
      const result = await tool.handler({ toolName: "list_objects", args: {} });
      const data = parseResult(result);
      expect(data).toEqual([]);
    });

    it("returns all objects", async () => {
      scene.create({ id: "a", name: "A", type: "box" });
      scene.create({ id: "b", name: "B", type: "sphere", parentId: "a" });

      const tool = registry.get("list_objects")!;
      const result = await tool.handler({ toolName: "list_objects", args: {} });
      const data = parseResult(result);
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe("a");
      expect(data[1].id).toBe("b");
      expect(data[1].parentId).toBe("a");
    });
  });

  describe("remove_object", () => {
    it("registers the tool", () => {
      expect(registry.has("remove_object")).toBe(true);
    });

    it("removes an object and its children", async () => {
      scene.create({ id: "parent", name: "Parent", type: "group" });
      scene.create({ id: "child", name: "Child", type: "box", parentId: "parent" });

      const tool = registry.get("remove_object")!;
      const result = await tool.handler({
        toolName: "remove_object",
        args: { objectId: "parent" },
      });
      const data = parseResult(result);
      expect(data.removed).toBe(true);
      expect(scene.count()).toBe(0);
      expect(bridge.execute).toHaveBeenCalledWith("removeObject", { objectId: "parent" });
    });

    it("throws when object not found", async () => {
      const tool = registry.get("remove_object")!;
      await expect(
        tool.handler({
          toolName: "remove_object",
          args: { objectId: "missing" },
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("clear_scene", () => {
    it("registers the tool", () => {
      expect(registry.has("clear_scene")).toBe(true);
    });

    it("clears all objects", async () => {
      scene.create({ id: "a", name: "A", type: "box" });
      scene.create({ id: "b", name: "B", type: "sphere" });

      const tool = registry.get("clear_scene")!;
      const result = await tool.handler({ toolName: "clear_scene", args: {} });
      const data = parseResult(result);
      expect(data.cleared).toBe(true);
      expect(scene.count()).toBe(0);
      expect(bridge.execute).toHaveBeenCalledWith("clearScene", {});
    });
  });
});
