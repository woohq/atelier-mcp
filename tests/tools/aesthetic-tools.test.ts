import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { EventBus } from "../../src/server/event-bus.js";
import { SceneEngine } from "../../src/engine/scene-engine.js";
import { PaletteRegistry } from "../../src/engine/palette-registry.js";
import { PluginLoader } from "../../src/plugins/plugin-loader.js";
import type { AtelierContext } from "../../src/plugins/define-tool.js";
import { registerAestheticTools } from "../../src/tools/builtin/aesthetic-tools.js";
import { parseToolResult } from "../helpers.js";

function createMockServer() {
  const registry = new ToolRegistry();
  const events = new EventBus();
  const scene = new SceneEngine();
  const palettes = new PaletteRegistry();
  const mockContext: AtelierContext = {
    invoke: vi.fn(async () => ({ ok: true })),
    palette: vi.fn(() => "#ffffff"),
    getObject: vi.fn(() => undefined),
    listObjects: vi.fn(() => []),
  };
  const plugins = new PluginLoader(registry, events, () => mockContext);

  const server = {
    registry,
    events,
    scene,
    palettes,
    plugins,
  } as any;

  return server;
}

describe("aesthetic-tools", () => {
  let server: ReturnType<typeof createMockServer>;
  let tmpDir: string;

  beforeEach(() => {
    server = createMockServer();
    registerAestheticTools(server);

    // Create a temp aesthetic directory
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-aesthetic-test-"));
  });

  afterEach(() => {
    server.plugins.stopWatching();
    server.plugins.unloadAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers load_aesthetic tool", () => {
    expect(server.registry.has("load_aesthetic")).toBe(true);
  });

  it("rejects nonexistent aesthetic directory", async () => {
    const tool = server.registry.get("load_aesthetic")!;
    await expect(
      tool.handler({ toolName: "load_aesthetic", args: { path: "/nonexistent/path" } }),
    ).rejects.toThrow("Aesthetic directory not found");
  });

  it("rejects aesthetic directory without tools/ subdirectory", async () => {
    const tool = server.registry.get("load_aesthetic")!;
    await expect(
      tool.handler({ toolName: "load_aesthetic", args: { path: tmpDir } }),
    ).rejects.toThrow("missing required tools/ subdirectory");
  });

  it("loads an aesthetic with tools", async () => {
    // Create tools/ subdirectory with a simple plugin
    const toolsDir = path.join(tmpDir, "tools");
    fs.mkdirSync(toolsDir);
    fs.writeFileSync(
      path.join(toolsDir, "my-plugin.js"),
      `export default {
        name: "my_aesthetic_tool",
        description: "An aesthetic tool",
        schema: {},
        handler: async () => ({ ok: true }),
      };`,
    );

    const tool = server.registry.get("load_aesthetic")!;
    const result = await tool.handler({
      toolName: "load_aesthetic",
      args: { path: tmpDir },
    });

    const parsed = parseToolResult(result);
    expect(parsed.data.tools).toContain("my_aesthetic_tool");
    expect(server.registry.has("my_aesthetic_tool")).toBe(true);
  });

  it("loads palettes from palettes/ subdirectory", async () => {
    const toolsDir = path.join(tmpDir, "tools");
    fs.mkdirSync(toolsDir);

    const palettesDir = path.join(tmpDir, "palettes");
    fs.mkdirSync(palettesDir);
    fs.writeFileSync(
      path.join(palettesDir, "warm.json"),
      JSON.stringify({ name: "warm", colors: ["#ff0000", "#ff8800", "#ffff00"] }),
    );

    const tool = server.registry.get("load_aesthetic")!;
    const result = await tool.handler({
      toolName: "load_aesthetic",
      args: { path: tmpDir },
    });

    const parsed = parseToolResult(result);
    expect(parsed.data.palettes).toContain("warm");
    expect(server.palettes.get("warm")?.colors).toEqual(["#ff0000", "#ff8800", "#ffff00"]);
  });

  it("clears the scene when loading a new aesthetic", async () => {
    // Add some objects to the scene
    server.scene.create({ name: "old_obj", type: "mesh" });
    expect(server.scene.count()).toBe(1);

    const toolsDir = path.join(tmpDir, "tools");
    fs.mkdirSync(toolsDir);

    const tool = server.registry.get("load_aesthetic")!;
    await tool.handler({
      toolName: "load_aesthetic",
      args: { path: tmpDir },
    });

    expect(server.scene.count()).toBe(0);
  });

  it("unloads previous aesthetic tools before loading new ones", async () => {
    // First aesthetic
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-aesthetic-test2-"));
    try {
      const toolsDir1 = path.join(tmpDir, "tools");
      fs.mkdirSync(toolsDir1);
      fs.writeFileSync(
        path.join(toolsDir1, "tool-a.js"),
        `export default {
          name: "aesthetic_tool_a",
          description: "Tool A",
          schema: {},
          handler: async () => ({ a: true }),
        };`,
      );

      const toolsDir2 = path.join(tmpDir2, "tools");
      fs.mkdirSync(toolsDir2);
      fs.writeFileSync(
        path.join(toolsDir2, "tool-b.js"),
        `export default {
          name: "aesthetic_tool_b",
          description: "Tool B",
          schema: {},
          handler: async () => ({ b: true }),
        };`,
      );

      const tool = server.registry.get("load_aesthetic")!;

      // Load first aesthetic
      await tool.handler({
        toolName: "load_aesthetic",
        args: { path: tmpDir },
      });
      expect(server.registry.has("aesthetic_tool_a")).toBe(true);

      // Load second aesthetic — first should be unloaded
      await tool.handler({
        toolName: "load_aesthetic",
        args: { path: tmpDir2 },
      });
      expect(server.registry.has("aesthetic_tool_a")).toBe(false);
      expect(server.registry.has("aesthetic_tool_b")).toBe(true);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  it("emits aesthetic:loaded event", async () => {
    const listener = vi.fn();
    server.events.on("aesthetic:loaded", listener);

    const toolsDir = path.join(tmpDir, "tools");
    fs.mkdirSync(toolsDir);

    const tool = server.registry.get("load_aesthetic")!;
    await tool.handler({
      toolName: "load_aesthetic",
      args: { path: tmpDir },
    });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ path: tmpDir }));
  });

  it("gracefully handles malformed palette files", async () => {
    const toolsDir = path.join(tmpDir, "tools");
    fs.mkdirSync(toolsDir);

    const palettesDir = path.join(tmpDir, "palettes");
    fs.mkdirSync(palettesDir);
    fs.writeFileSync(path.join(palettesDir, "bad.json"), "not valid json {{{");

    const tool = server.registry.get("load_aesthetic")!;
    // Should not throw — just skip the bad palette
    const result = await tool.handler({
      toolName: "load_aesthetic",
      args: { path: tmpDir },
    });

    const parsed = parseToolResult(result);
    expect(parsed.data.palettes).toEqual([]);
  });
});
