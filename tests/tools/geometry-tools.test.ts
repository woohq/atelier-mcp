import { describe, it, expect, vi, beforeEach } from "vitest";
import { SceneEngine } from "../../src/engine/scene-engine.js";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { registerGeometryTools } from "../../src/tools/builtin/geometry-tools.js";

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

function createMockServer() {
  const scene = new SceneEngine();
  const registry = new ToolRegistry();
  const bridge = { execute: vi.fn().mockResolvedValue({ ok: true }), getScreenshot: vi.fn() };
  const server = { scene, registry, bridge } as any;
  registerGeometryTools(server);
  return { server, scene, registry, bridge };
}

describe("Geometry Tools", () => {
  let _server: any;
  let scene: SceneEngine;
  let registry: ToolRegistry;
  let bridge: any;

  beforeEach(() => {
    ({ server: _server, scene, registry, bridge } = createMockServer());
  });

  describe("create_primitive", () => {
    it("registers the tool", () => {
      expect(registry.has("create_primitive")).toBe(true);
    });

    it("creates a box and tracks it in scene engine", async () => {
      const tool = registry.get("create_primitive")!;
      const result = await tool.handler({
        toolName: "create_primitive",
        args: { shape: "box", width: 2, height: 3, depth: 1 },
      });
      const data = parseResult(result);
      expect(data.shape).toBe("box");
      expect(data.id).toMatch(/^box_/);
      expect(scene.count()).toBe(1);
      expect(bridge.execute).toHaveBeenCalledWith(
        "createPrimitive",
        expect.objectContaining({ shape: "box", width: 2 }),
      );
    });

    it("creates a sphere with position and color", async () => {
      const tool = registry.get("create_primitive")!;
      const result = await tool.handler({
        toolName: "create_primitive",
        args: { shape: "sphere", radius: 1.5, position: [1, 2, 3], color: "#ff0000" },
      });
      const data = parseResult(result);
      expect(data.shape).toBe("sphere");
      expect(scene.get(data.id)?.metadata.position).toEqual([1, 2, 3]);
    });

    it("creates all primitive types", async () => {
      const tool = registry.get("create_primitive")!;
      const shapes = ["box", "sphere", "cylinder", "cone", "torus", "plane"] as const;
      for (const shape of shapes) {
        await tool.handler({ toolName: "create_primitive", args: { shape } });
      }
      expect(scene.count()).toBe(shapes.length);
    });
  });

  describe("create_mesh", () => {
    it("registers the tool", () => {
      expect(registry.has("create_mesh")).toBe(true);
    });

    it("creates a mesh from vertices", async () => {
      const tool = registry.get("create_mesh")!;
      // Simple triangle
      const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const result = await tool.handler({
        toolName: "create_mesh",
        args: { vertices },
      });
      const data = parseResult(result);
      expect(data.id).toMatch(/^mesh_/);
      expect(data.vertexCount).toBe(3);
      expect(scene.count()).toBe(1);
      expect(bridge.execute).toHaveBeenCalledWith(
        "createMesh",
        expect.objectContaining({ vertices }),
      );
    });

    it("rejects vertices not divisible by 3", async () => {
      const tool = registry.get("create_mesh")!;
      await expect(
        tool.handler({
          toolName: "create_mesh",
          args: { vertices: [0, 0, 0, 1, 0] },
        }),
      ).rejects.toThrow("multiple of 3");
    });

    it("passes faces, uvs, and normals to bridge", async () => {
      const tool = registry.get("create_mesh")!;
      const args = {
        vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        faces: [0, 1, 2],
        uvs: [0, 0, 1, 0, 0, 1],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
      };
      await tool.handler({ toolName: "create_mesh", args });
      expect(bridge.execute).toHaveBeenCalledWith(
        "createMesh",
        expect.objectContaining({
          faces: [0, 1, 2],
          uvs: args.uvs,
          normals: args.normals,
        }),
      );
    });
  });

  describe("boolean_op", () => {
    it("registers the tool", () => {
      expect(registry.has("boolean_op")).toBe(true);
    });

    it("returns not-yet-implemented status", async () => {
      // Create two objects first
      scene.create({ id: "a", name: "a", type: "box" });
      scene.create({ id: "b", name: "b", type: "sphere" });
      bridge.execute.mockResolvedValueOnce({
        status: "not_yet_implemented",
      });

      const tool = registry.get("boolean_op")!;
      const result = await tool.handler({
        toolName: "boolean_op",
        args: { targetId: "a", toolId: "b", operation: "subtract" },
      });
      const data = parseResult(result);
      expect(data.status).toBe("not_yet_implemented");
    });

    it("throws when target not found", async () => {
      scene.create({ id: "b", name: "b", type: "sphere" });
      const tool = registry.get("boolean_op")!;
      await expect(
        tool.handler({
          toolName: "boolean_op",
          args: { targetId: "missing", toolId: "b", operation: "union" },
        }),
      ).rejects.toThrow("not found");
    });

    it("throws when tool not found", async () => {
      scene.create({ id: "a", name: "a", type: "box" });
      const tool = registry.get("boolean_op")!;
      await expect(
        tool.handler({
          toolName: "boolean_op",
          args: { targetId: "a", toolId: "missing", operation: "intersect" },
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("extrude", () => {
    it("registers the tool", () => {
      expect(registry.has("extrude")).toBe(true);
    });

    it("extrudes a profile and tracks in scene", async () => {
      const tool = registry.get("extrude")!;
      const points: [number, number][] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ];
      const result = await tool.handler({
        toolName: "extrude",
        args: { points, depth: 2 },
      });
      const data = parseResult(result);
      expect(data.id).toMatch(/^extrude_/);
      expect(data.pointCount).toBe(4);
      expect(data.depth).toBe(2);
      expect(scene.count()).toBe(1);
      expect(bridge.execute).toHaveBeenCalledWith(
        "extrude",
        expect.objectContaining({ points, depth: 2 }),
      );
    });
  });

  describe("deform", () => {
    it("registers the tool", () => {
      expect(registry.has("deform")).toBe(true);
    });

    it("sends deform command to bridge", async () => {
      scene.create({ id: "obj_1", name: "obj_1", type: "box" });
      bridge.execute.mockResolvedValueOnce({
        objectId: "obj_1",
        type: "noise",
        verticesModified: 24,
      });

      const tool = registry.get("deform")!;
      const result = await tool.handler({
        toolName: "deform",
        args: { objectId: "obj_1", type: "noise", params: { amplitude: 0.3 } },
      });
      const data = parseResult(result);
      expect(data.objectId).toBe("obj_1");
      expect(data.deformType).toBe("noise");
    });

    it("throws when object not found", async () => {
      const tool = registry.get("deform")!;
      await expect(
        tool.handler({
          toolName: "deform",
          args: { objectId: "missing", type: "noise" },
        }),
      ).rejects.toThrow("not found");
    });
  });
});
