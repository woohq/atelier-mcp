import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { registerCanvasTools } from "../../src/tools/builtin/canvas-tools.js";

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

function createMockServer() {
  const registry = new ToolRegistry();
  const bridge = {
    execute: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    getScreenshot: vi.fn(),
  };
  const scene = { create: vi.fn(), get: vi.fn(), list: vi.fn() };
  const server = { scene, registry, bridge } as any;
  registerCanvasTools(server);
  return { server, registry, bridge };
}

describe("Canvas Tools", () => {
  let registry: ToolRegistry;
  let bridge: any;

  beforeEach(() => {
    ({ registry, bridge } = createMockServer());
  });

  describe("create_canvas", () => {
    it("registers the tool", () => {
      expect(registry.has("create_canvas")).toBe(true);
    });

    it("calls bridge with createCanvas command", async () => {
      bridge.execute.mockResolvedValue({ width: 256, height: 256 });

      const tool = registry.get("create_canvas")!;
      const result = await tool.handler({
        toolName: "create_canvas",
        args: { width: 256, height: 256, background: "#000000" },
      });
      const data = parseResult(result);
      expect(data.width).toBe(256);

      expect(bridge.execute).toHaveBeenCalledWith("createCanvas", {
        width: 256,
        height: 256,
        background: "#000000",
      });
    });

    it("calls bridge without background when not specified", async () => {
      bridge.execute.mockResolvedValue({ width: 64, height: 64 });

      const tool = registry.get("create_canvas")!;
      await tool.handler({
        toolName: "create_canvas",
        args: { width: 64, height: 64 },
      });

      expect(bridge.execute).toHaveBeenCalledWith("createCanvas", {
        width: 64,
        height: 64,
      });
    });
  });

  describe("draw_shape", () => {
    it("registers the tool", () => {
      expect(registry.has("draw_shape")).toBe(true);
    });

    it("calls bridge with drawShape for rect", async () => {
      bridge.execute.mockResolvedValue({ ok: true });

      const tool = registry.get("draw_shape")!;
      await tool.handler({
        toolName: "draw_shape",
        args: {
          shape: "rect",
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          fill: "#ff0000",
        },
      });

      expect(bridge.execute).toHaveBeenCalledWith(
        "drawShape",
        expect.objectContaining({
          shape: "rect",
          x: 10,
          y: 20,
          width: 100,
          height: 50,
          fill: "#ff0000",
        }),
      );
    });

    it("calls bridge with drawShape for circle", async () => {
      bridge.execute.mockResolvedValue({ ok: true });

      const tool = registry.get("draw_shape")!;
      await tool.handler({
        toolName: "draw_shape",
        args: {
          shape: "circle",
          x: 50,
          y: 50,
          radius: 25,
          fill: "#00ff00",
          stroke: "#ffffff",
          lineWidth: 2,
        },
      });

      expect(bridge.execute).toHaveBeenCalledWith(
        "drawShape",
        expect.objectContaining({
          shape: "circle",
          x: 50,
          y: 50,
          radius: 25,
        }),
      );
    });

    it("calls bridge with drawShape for polygon", async () => {
      bridge.execute.mockResolvedValue({ ok: true });

      const tool = registry.get("draw_shape")!;
      await tool.handler({
        toolName: "draw_shape",
        args: {
          shape: "polygon",
          points: [
            [0, 0],
            [100, 0],
            [50, 86],
          ],
          fill: "#0000ff",
        },
      });

      expect(bridge.execute).toHaveBeenCalledWith(
        "drawShape",
        expect.objectContaining({
          shape: "polygon",
          points: [
            [0, 0],
            [100, 0],
            [50, 86],
          ],
        }),
      );
    });
  });

  describe("draw_line", () => {
    it("registers the tool", () => {
      expect(registry.has("draw_line")).toBe(true);
    });

    it("calls bridge with drawLine command", async () => {
      bridge.execute.mockResolvedValue({ ok: true });

      const tool = registry.get("draw_line")!;
      await tool.handler({
        toolName: "draw_line",
        args: {
          points: [
            [0, 0],
            [100, 100],
            [200, 50],
          ],
          color: "#ff0000",
          width: 3,
        },
      });

      expect(bridge.execute).toHaveBeenCalledWith("drawLine", {
        points: [
          [0, 0],
          [100, 100],
          [200, 50],
        ],
        color: "#ff0000",
        width: 3,
      });
    });
  });

  describe("fill", () => {
    it("registers the tool", () => {
      expect(registry.has("fill")).toBe(true);
    });

    it("calls bridge with floodFill command", async () => {
      bridge.execute.mockResolvedValue({ ok: true, filled: 1024 });

      const tool = registry.get("fill")!;
      const result = await tool.handler({
        toolName: "fill",
        args: { x: 50, y: 50, color: "#ff0000" },
      });
      const data = parseResult(result);
      expect(data).toBeDefined();

      expect(bridge.execute).toHaveBeenCalledWith("floodFill", {
        x: 50,
        y: 50,
        color: "#ff0000",
      });
    });

    it("passes tolerance parameter", async () => {
      bridge.execute.mockResolvedValue({ ok: true, filled: 512 });

      const tool = registry.get("fill")!;
      await tool.handler({
        toolName: "fill",
        args: { x: 10, y: 10, color: "#00ff00", tolerance: 30 },
      });

      expect(bridge.execute).toHaveBeenCalledWith("floodFill", {
        x: 10,
        y: 10,
        color: "#00ff00",
        tolerance: 30,
      });
    });
  });

  describe("set_pixel", () => {
    it("registers the tool", () => {
      expect(registry.has("set_pixel")).toBe(true);
    });

    it("calls bridge with setPixel command", async () => {
      bridge.execute.mockResolvedValue({ count: 3 });

      const tool = registry.get("set_pixel")!;
      const result = await tool.handler({
        toolName: "set_pixel",
        args: {
          pixels: [
            { x: 0, y: 0, color: "#ff0000" },
            { x: 1, y: 0, color: "#00ff00" },
            { x: 2, y: 0, color: "#0000ff" },
          ],
        },
      });
      const data = parseResult(result);
      expect(data.count).toBe(3);

      expect(bridge.execute).toHaveBeenCalledWith("setPixel", {
        pixels: [
          { x: 0, y: 0, color: "#ff0000" },
          { x: 1, y: 0, color: "#00ff00" },
          { x: 2, y: 0, color: "#0000ff" },
        ],
      });
    });
  });

  describe("create_layer", () => {
    it("registers the tool", () => {
      expect(registry.has("create_layer")).toBe(true);
    });

    it("calls bridge with createLayer command", async () => {
      bridge.execute.mockResolvedValue({ name: "foreground", index: 0, totalLayers: 1 });

      const tool = registry.get("create_layer")!;
      const result = await tool.handler({
        toolName: "create_layer",
        args: { name: "foreground", opacity: 0.8, blendMode: "multiply" },
      });
      const data = parseResult(result);
      expect(data.name).toBe("foreground");

      expect(bridge.execute).toHaveBeenCalledWith("createLayer", {
        name: "foreground",
        opacity: 0.8,
        blendMode: "multiply",
      });
    });

    it("uses defaults for optional parameters", async () => {
      bridge.execute.mockResolvedValue({ name: "bg", index: 0, totalLayers: 1 });

      const tool = registry.get("create_layer")!;
      await tool.handler({
        toolName: "create_layer",
        args: { name: "bg" },
      });

      expect(bridge.execute).toHaveBeenCalledWith("createLayer", {
        name: "bg",
      });
    });
  });

  describe("blend_layers", () => {
    it("registers the tool", () => {
      expect(registry.has("blend_layers")).toBe(true);
    });

    it("calls bridge with blendLayers command", async () => {
      bridge.execute.mockResolvedValue({ ok: true, layersBlended: 3 });

      const tool = registry.get("blend_layers")!;
      const result = await tool.handler({
        toolName: "blend_layers",
        args: {},
      });
      const data = parseResult(result);
      expect(data.ok).toBe(true);
      expect(data.layersBlended).toBe(3);

      expect(bridge.execute).toHaveBeenCalledWith("blendLayers", {});
    });
  });

  describe("palette_swap", () => {
    it("registers the tool", () => {
      expect(registry.has("palette_swap")).toBe(true);
    });

    it("calls bridge with paletteSwap command", async () => {
      bridge.execute.mockResolvedValue({ ok: true, swapped: 150 });

      const tool = registry.get("palette_swap")!;
      const result = await tool.handler({
        toolName: "palette_swap",
        args: { sourceColor: "#ff0000", targetColor: "#00ff00" },
      });
      const data = parseResult(result);
      expect(data.ok).toBe(true);
      expect(data.swapped).toBe(150);

      expect(bridge.execute).toHaveBeenCalledWith("paletteSwap", {
        sourceColor: "#ff0000",
        targetColor: "#00ff00",
      });
    });

    it("passes tolerance parameter", async () => {
      bridge.execute.mockResolvedValue({ ok: true, swapped: 200 });

      const tool = registry.get("palette_swap")!;
      await tool.handler({
        toolName: "palette_swap",
        args: { sourceColor: "#ff0000", targetColor: "#0000ff", tolerance: 10 },
      });

      expect(bridge.execute).toHaveBeenCalledWith("paletteSwap", {
        sourceColor: "#ff0000",
        targetColor: "#0000ff",
        tolerance: 10,
      });
    });
  });

  describe("all tools are registered", () => {
    it("registers all 8 canvas tools", () => {
      const expectedTools = [
        "create_canvas",
        "draw_shape",
        "draw_line",
        "fill",
        "set_pixel",
        "create_layer",
        "blend_layers",
        "palette_swap",
      ];
      for (const name of expectedTools) {
        expect(registry.has(name), `Expected tool "${name}" to be registered`).toBe(true);
      }
    });
  });
});
