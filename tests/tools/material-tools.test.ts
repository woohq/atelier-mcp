import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { PaletteRegistry } from "../../src/engine/palette-registry.js";
import { registerMaterialTools } from "../../src/tools/builtin/material-tools.js";

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

function createMockServer() {
  const registry = new ToolRegistry();
  const palettes = new PaletteRegistry();
  const bridge = { execute: vi.fn().mockResolvedValue({ ok: true }), getScreenshot: vi.fn() };
  const server = { registry, palettes, bridge } as any;
  registerMaterialTools(server);
  return { server, registry, palettes, bridge };
}

describe("Material Tools", () => {
  let registry: ToolRegistry;
  let palettes: PaletteRegistry;
  let bridge: any;

  beforeEach(() => {
    ({ registry, palettes, bridge } = createMockServer());
  });

  describe("set_material", () => {
    it("registers the tool", () => {
      expect(registry.has("set_material")).toBe(true);
    });

    it("sends material properties to bridge", async () => {
      const tool = registry.get("set_material")!;
      const result = await tool.handler({
        toolName: "set_material",
        args: { objectId: "mesh_1", color: "#ff0000", metalness: 0.8, roughness: 0.2 },
      });

      expect(bridge.execute).toHaveBeenCalledWith("setMaterial", {
        objectId: "mesh_1",
        color: "#ff0000",
        metalness: 0.8,
        roughness: 0.2,
      });

      const data = parseResult(result);
      expect(data.objectId).toBe("mesh_1");
      expect(data.material.color).toBe("#ff0000");
      expect(data.status).toBe("applied");
    });

    it("sends emissive properties", async () => {
      const tool = registry.get("set_material")!;
      await tool.handler({
        toolName: "set_material",
        args: { objectId: "mesh_1", emissive: "#00ff00", emissiveIntensity: 2.5 },
      });

      expect(bridge.execute).toHaveBeenCalledWith("setMaterial", {
        objectId: "mesh_1",
        emissive: "#00ff00",
        emissiveIntensity: 2.5,
      });
    });

    it("sends opacity and wireframe", async () => {
      const tool = registry.get("set_material")!;
      await tool.handler({
        toolName: "set_material",
        args: { objectId: "mesh_1", opacity: 0.5, wireframe: true, flatShading: true },
      });

      expect(bridge.execute).toHaveBeenCalledWith("setMaterial", {
        objectId: "mesh_1",
        opacity: 0.5,
        wireframe: true,
        flatShading: true,
      });
    });
  });

  describe("set_palette", () => {
    it("registers the tool", () => {
      expect(registry.has("set_palette")).toBe(true);
    });

    it("registers a palette and makes it active", async () => {
      const tool = registry.get("set_palette")!;
      const result = await tool.handler({
        toolName: "set_palette",
        args: { name: "warm", colors: ["#ff0000", "#ff8800", "#ffff00"] },
      });

      const data = parseResult(result);
      expect(data.palette).toBe("warm");
      expect(data.colorCount).toBe(3);
      expect(data.active).toBe(true);
      expect(data.status).toBe("registered");

      // Verify it was actually registered
      expect(palettes.get("warm")).toBeDefined();
      expect(palettes.getActive()?.name).toBe("warm");
    });

    it("does not call bridge", async () => {
      const tool = registry.get("set_palette")!;
      await tool.handler({
        toolName: "set_palette",
        args: { name: "test", colors: ["#000"] },
      });

      expect(bridge.execute).not.toHaveBeenCalled();
    });
  });

  describe("apply_palette", () => {
    it("registers the tool", () => {
      expect(registry.has("apply_palette")).toBe(true);
    });

    it("maps objects to palette colors via bridge", async () => {
      palettes.register({ name: "rgb", colors: ["#ff0000", "#00ff00", "#0000ff"] });
      palettes.setActive("rgb");

      const tool = registry.get("apply_palette")!;
      const result = await tool.handler({
        toolName: "apply_palette",
        args: {
          mappings: [
            { objectId: "mesh_1", paletteIndex: 0 },
            { objectId: "mesh_2", paletteIndex: 2 },
          ],
        },
      });

      expect(bridge.execute).toHaveBeenCalledTimes(2);
      expect(bridge.execute).toHaveBeenCalledWith("setMaterial", {
        objectId: "mesh_1",
        color: "#ff0000",
      });
      expect(bridge.execute).toHaveBeenCalledWith("setMaterial", {
        objectId: "mesh_2",
        color: "#0000ff",
      });

      const data = parseResult(result);
      expect(data.applied).toHaveLength(2);
      expect(data.applied[0]).toEqual({
        objectId: "mesh_1",
        color: "#ff0000",
        paletteIndex: 0,
      });
      expect(data.status).toBe("applied");
    });

    it("uses explicit palette name over active", async () => {
      palettes.register({ name: "active-pal", colors: ["#111111"] });
      palettes.register({ name: "explicit-pal", colors: ["#222222", "#333333"] });
      palettes.setActive("active-pal");

      const tool = registry.get("apply_palette")!;
      await tool.handler({
        toolName: "apply_palette",
        args: {
          mappings: [{ objectId: "mesh_1", paletteIndex: 1 }],
          palette: "explicit-pal",
        },
      });

      expect(bridge.execute).toHaveBeenCalledWith("setMaterial", {
        objectId: "mesh_1",
        color: "#333333",
      });
    });

    it("throws when palette index is out of bounds", async () => {
      palettes.register({ name: "small", colors: ["#000"] });

      const tool = registry.get("apply_palette")!;
      await expect(
        tool.handler({
          toolName: "apply_palette",
          args: {
            mappings: [{ objectId: "mesh_1", paletteIndex: 5 }],
            palette: "small",
          },
        }),
      ).rejects.toThrow("out of bounds");
    });

    it("throws when no palette available", async () => {
      const tool = registry.get("apply_palette")!;
      await expect(
        tool.handler({
          toolName: "apply_palette",
          args: {
            mappings: [{ objectId: "mesh_1", paletteIndex: 0 }],
          },
        }),
      ).rejects.toThrow("No palette specified");
    });
  });
});
