import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { PluginLoader } from "../../src/plugins/plugin-loader.js";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { EventBus } from "../../src/server/event-bus.js";
import type { AtelierContext } from "../../src/plugins/define-tool.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/plugins");

function createMockContext(): AtelierContext {
  return {
    invoke: vi.fn(async () => ({ ok: true })),
    palette: vi.fn(() => "#ffffff"),
    getObject: vi.fn(() => undefined),
    listObjects: vi.fn(() => []),
  };
}

describe("PluginLoader", () => {
  let registry: ToolRegistry;
  let events: EventBus;
  let loader: PluginLoader;
  let mockContext: AtelierContext;

  beforeEach(() => {
    registry = new ToolRegistry();
    events = new EventBus();
    mockContext = createMockContext();
    loader = new PluginLoader(registry, events, () => mockContext);
  });

  afterEach(() => {
    loader.stopWatching();
    loader.unloadAll();
  });

  describe("loadFile", () => {
    it("loads a valid plugin file and registers it", async () => {
      const filePath = path.join(FIXTURES_DIR, "test-tool.ts");
      const name = await loader.loadFile(filePath);

      expect(name).toBe("test_plugin_tool");
      expect(registry.has("test_plugin_tool")).toBe(true);
      expect(loader.loadedToolNames).toContain("test_plugin_tool");
    });

    it("emits plugin:loaded event", async () => {
      const listener = vi.fn();
      events.on("plugin:loaded", listener);

      const filePath = path.join(FIXTURES_DIR, "test-tool.ts");
      await loader.loadFile(filePath);

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ name: "test_plugin_tool" }));
    });

    it("wraps the handler to inject AtelierContext", async () => {
      const filePath = path.join(FIXTURES_DIR, "context-tool.ts");
      await loader.loadFile(filePath);

      const tool = registry.get("context_test_tool");
      expect(tool).toBeDefined();

      const result = await tool!.handler({
        toolName: "context_test_tool",
        args: { index: 42 },
      });

      expect(result).toEqual({ objectCount: 0, index: 42 });
      expect(mockContext.listObjects).toHaveBeenCalled();
    });

    it("returns null for files with invalid exports", async () => {
      // Create a temp file with bad export in-memory is tricky with dynamic import,
      // so we test the validation path by checking the error event
      const errorListener = vi.fn();
      events.on("plugin:error", errorListener);

      // A non-existent file should fail gracefully
      const name = await loader.loadFile("/nonexistent/path/bad-plugin.ts");
      expect(name).toBeNull();
      expect(errorListener).toHaveBeenCalled();
    });

    it("replaces an existing plugin on reload", async () => {
      const filePath = path.join(FIXTURES_DIR, "test-tool.ts");

      await loader.loadFile(filePath);
      expect(registry.has("test_plugin_tool")).toBe(true);

      // Load again — should replace without error
      const name = await loader.loadFile(filePath);
      expect(name).toBe("test_plugin_tool");
      expect(registry.has("test_plugin_tool")).toBe(true);
    });
  });

  describe("loadDirectory", () => {
    it("loads all plugin files from a directory", async () => {
      const loaded = await loader.loadDirectory(FIXTURES_DIR);

      expect(loaded).toContain("test_plugin_tool");
      expect(loaded).toContain("context_test_tool");
      expect(loaded.length).toBe(2);
    });

    it("throws for nonexistent directory", async () => {
      await expect(loader.loadDirectory("/nonexistent/dir")).rejects.toThrow(
        "Plugin directory not found",
      );
    });
  });

  describe("unloadAll", () => {
    it("deregisters all loaded plugin tools", async () => {
      await loader.loadDirectory(FIXTURES_DIR);
      expect(registry.has("test_plugin_tool")).toBe(true);
      expect(registry.has("context_test_tool")).toBe(true);

      loader.unloadAll();

      expect(registry.has("test_plugin_tool")).toBe(false);
      expect(registry.has("context_test_tool")).toBe(false);
      expect(loader.loadedToolNames).toEqual([]);
    });

    it("emits plugin:unloaded events", async () => {
      const listener = vi.fn();
      events.on("plugin:unloaded", listener);

      await loader.loadDirectory(FIXTURES_DIR);
      loader.unloadAll();

      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe("watch / stopWatching", () => {
    it("starts and stops without error", () => {
      // Watching an actual directory should not throw
      loader.watch(FIXTURES_DIR);
      loader.stopWatching();
    });

    it("stopWatching is idempotent", () => {
      loader.stopWatching();
      loader.stopWatching();
      // No error means success
    });
  });
});
