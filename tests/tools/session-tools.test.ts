import { describe, it, expect, vi, beforeEach } from "vitest";
import { SceneEngine } from "../../src/engine/scene-engine.js";
import { PaletteRegistry } from "../../src/engine/palette-registry.js";
import { ShaderRegistry } from "../../src/engine/shader-registry.js";
import { CommandHistory } from "../../src/engine/command-history.js";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { registerSessionTools } from "../../src/tools/builtin/session-tools.js";

function createMockServer() {
  const scene = new SceneEngine();
  const palettes = new PaletteRegistry();
  const shaders = new ShaderRegistry();
  const history = new CommandHistory();
  const registry = new ToolRegistry();
  const bridge = {
    execute: vi.fn().mockResolvedValue({ ok: true }),
    getScreenshot: vi.fn().mockResolvedValue("base64png"),
  };

  const server = { scene, palettes, shaders, history, registry, bridge } as any;
  registerSessionTools(server);
  return { server, scene, palettes, shaders, history, registry, bridge };
}

describe("session-tools", () => {
  let server: any;
  let history: CommandHistory;
  let registry: ToolRegistry;

  beforeEach(() => {
    const mock = createMockServer();
    server = mock.server;
    history = mock.history;
    registry = mock.registry;
  });

  describe("undo", () => {
    it("returns nothing-to-undo when history is empty", async () => {
      const tool = registry.get("undo")!;
      const result: any = await tool.handler({ toolName: "undo", args: {} });
      expect(result.content[0].text).toContain("Nothing to undo");
    });

    it("undoes a create_primitive by removing the object", async () => {
      server.scene.create({ id: "box_1", name: "box_1", type: "box" });
      history.push({
        toolName: "create_primitive",
        args: { shape: "box" },
        undoData: { id: "box_1" },
        timestamp: Date.now(),
      });

      const tool = registry.get("undo")!;
      const result: any = await tool.handler({ toolName: "undo", args: {} });
      const data = JSON.parse(result.content[0].text);
      expect(data.undone).toBe("create_primitive");
      expect(server.scene.get("box_1")).toBeUndefined();
      expect(server.bridge.execute).toHaveBeenCalledWith("removeObject", { objectId: "box_1" });
    });

    it("undoes remove_object by recreating the object", async () => {
      const obj = {
        id: "sphere_1",
        name: "sphere_1",
        type: "sphere",
        parentId: null,
        metadata: { radius: 2 },
      };
      history.push({
        toolName: "remove_object",
        args: { objectId: "sphere_1" },
        undoData: { object: obj },
        timestamp: Date.now(),
      });

      const tool = registry.get("undo")!;
      await tool.handler({ toolName: "undo", args: {} });
      expect(server.scene.get("sphere_1")).toBeDefined();
    });
  });

  describe("redo", () => {
    it("returns nothing-to-redo when redo stack is empty", async () => {
      const tool = registry.get("redo")!;
      const result: any = await tool.handler({ toolName: "redo", args: {} });
      expect(result.content[0].text).toContain("Nothing to redo");
    });
  });
});
