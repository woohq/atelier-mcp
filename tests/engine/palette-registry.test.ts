import { describe, it, expect, beforeEach } from "vitest";
import { PaletteRegistry } from "../../src/engine/palette-registry.js";
import {
  SHIPPED_PALETTES,
  PICO8,
  ENDESGA32,
  RESURRECT64,
} from "../../src/engine/shipped-palettes.js";

describe("PaletteRegistry", () => {
  let registry: PaletteRegistry;

  beforeEach(() => {
    registry = new PaletteRegistry();
  });

  describe("register / get / list", () => {
    it("registers and retrieves a palette", () => {
      registry.register({ name: "test", colors: ["#ff0000", "#00ff00"] });
      const palette = registry.get("test");
      expect(palette).toBeDefined();
      expect(palette!.name).toBe("test");
      expect(palette!.colors).toEqual(["#ff0000", "#00ff00"]);
    });

    it("returns undefined for unknown palette", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("lists registered palette names", () => {
      registry.register({ name: "a", colors: ["#000"] });
      registry.register({ name: "b", colors: ["#fff"] });
      expect(registry.list()).toEqual(["a", "b"]);
    });

    it("overwrites palette with same name", () => {
      registry.register({ name: "dup", colors: ["#111"] });
      registry.register({ name: "dup", colors: ["#222", "#333"] });
      expect(registry.get("dup")!.colors).toEqual(["#222", "#333"]);
    });
  });

  describe("active palette", () => {
    it("returns undefined when no active palette is set", () => {
      expect(registry.getActive()).toBeUndefined();
    });

    it("sets and gets the active palette", () => {
      registry.register({ name: "primary", colors: ["#ff0000"] });
      registry.setActive("primary");
      const active = registry.getActive();
      expect(active).toBeDefined();
      expect(active!.name).toBe("primary");
    });

    it("throws when setting active to unknown palette", () => {
      expect(() => registry.setActive("missing")).toThrow('Palette "missing" not found');
    });
  });

  describe("resolveColor", () => {
    beforeEach(() => {
      registry.register({ name: "rgb", colors: ["#ff0000", "#00ff00", "#0000ff"] });
    });

    it("resolves color by index and palette name", () => {
      expect(registry.resolveColor(0, "rgb")).toBe("#ff0000");
      expect(registry.resolveColor(1, "rgb")).toBe("#00ff00");
      expect(registry.resolveColor(2, "rgb")).toBe("#0000ff");
    });

    it("resolves color using active palette when no name given", () => {
      registry.setActive("rgb");
      expect(registry.resolveColor(1)).toBe("#00ff00");
    });

    it("throws for out-of-bounds index", () => {
      expect(() => registry.resolveColor(3, "rgb")).toThrow(
        'Palette index 3 out of bounds for palette "rgb" (0-2)',
      );
    });

    it("throws for negative index", () => {
      expect(() => registry.resolveColor(-1, "rgb")).toThrow("out of bounds");
    });

    it("throws when no palette specified and no active palette", () => {
      expect(() => registry.resolveColor(0)).toThrow("No palette specified and no active palette");
    });

    it("throws when named palette not found", () => {
      expect(() => registry.resolveColor(0, "missing")).toThrow('Palette "missing" not found');
    });
  });

  describe("clear", () => {
    it("removes all palettes and resets active", () => {
      registry.register({ name: "a", colors: ["#000"] });
      registry.setActive("a");
      registry.clear();
      expect(registry.list()).toEqual([]);
      expect(registry.getActive()).toBeUndefined();
    });
  });

  describe("shipped palettes", () => {
    it("PICO8 has 16 colors", () => {
      expect(PICO8.colors).toHaveLength(16);
      expect(PICO8.name).toBe("pico8");
    });

    it("ENDESGA32 has 32 colors", () => {
      expect(ENDESGA32.colors).toHaveLength(32);
      expect(ENDESGA32.name).toBe("endesga32");
    });

    it("RESURRECT64 has 16 colors (first 16)", () => {
      expect(RESURRECT64.colors).toHaveLength(16);
      expect(RESURRECT64.name).toBe("resurrect64");
    });

    it("SHIPPED_PALETTES contains all three", () => {
      expect(SHIPPED_PALETTES).toHaveLength(3);
      const names = SHIPPED_PALETTES.map((p) => p.name);
      expect(names).toEqual(["pico8", "endesga32", "resurrect64"]);
    });

    it("all shipped palette colors are valid hex strings", () => {
      const hexPattern = /^#[0-9A-Fa-f]{6}$/;
      for (const palette of SHIPPED_PALETTES) {
        for (const color of palette.colors) {
          expect(color).toMatch(hexPattern);
        }
      }
    });
  });
});
