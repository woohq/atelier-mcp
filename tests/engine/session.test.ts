import { describe, it, expect, beforeEach } from "vitest";
import { SceneEngine } from "../../src/engine/scene-engine.js";
import { PaletteRegistry } from "../../src/engine/palette-registry.js";
import { ShaderRegistry } from "../../src/engine/shader-registry.js";
import { captureSession, restoreSession } from "../../src/engine/session.js";

describe("Session", () => {
  let scene: SceneEngine;
  let palettes: PaletteRegistry;
  let shaders: ShaderRegistry;

  beforeEach(() => {
    scene = new SceneEngine();
    palettes = new PaletteRegistry();
    shaders = new ShaderRegistry();
  });

  describe("captureSession", () => {
    it("captures empty state", () => {
      const data = captureSession(scene, palettes, shaders);
      expect(data.version).toBe(1);
      expect(data.objects).toEqual([]);
      expect(data.palettes).toEqual([]);
      expect(data.activePalette).toBeNull();
      expect(data.effects).toEqual([]);
      expect(data.customShaders).toEqual([]);
    });

    it("captures objects and palettes", () => {
      scene.create({ id: "box1", name: "box1", type: "box" });
      scene.create({ id: "sphere1", name: "sphere1", type: "sphere" });
      palettes.register({ name: "warm", colors: ["#ff0000", "#ff8800"] });
      palettes.setActive("warm");

      const data = captureSession(scene, palettes, shaders);
      expect(data.objects).toHaveLength(2);
      expect(data.palettes).toHaveLength(1);
      expect(data.activePalette).toBe("warm");
    });

    it("captures effects and shaders", () => {
      shaders.addEffect({ type: "pixelate", params: { pixelSize: 4 } });
      shaders.registerShader({
        id: "s1",
        name: "custom",
        fragmentShader: "void main() {}",
        vertexShader: "",
        uniforms: {},
      });

      const data = captureSession(scene, palettes, shaders);
      expect(data.effects).toHaveLength(1);
      expect(data.customShaders).toHaveLength(1);
    });
  });

  describe("restoreSession", () => {
    it("restores objects", () => {
      const data = captureSession(scene, palettes, shaders);
      scene.create({ id: "a", name: "a", type: "box" });
      data.objects = [{ id: "b", name: "b", type: "sphere", parentId: null, metadata: {} }];

      restoreSession(data, scene, palettes, shaders);
      expect(scene.count()).toBe(1);
      expect(scene.get("b")).toBeDefined();
      expect(scene.get("a")).toBeUndefined();
    });

    it("restores palettes and active palette", () => {
      const data = captureSession(scene, palettes, shaders);
      data.palettes = [{ name: "test", colors: ["#000", "#fff"] }];
      data.activePalette = "test";

      restoreSession(data, scene, palettes, shaders);
      expect(palettes.getActive()?.name).toBe("test");
      expect(palettes.resolveColor(0, "test")).toBe("#000");
    });

    it("restores effects", () => {
      const data = captureSession(scene, palettes, shaders);
      data.effects = [{ id: "fx1", type: "pixelate", params: { pixelSize: 8 }, order: 0 }];

      restoreSession(data, scene, palettes, shaders);
      expect(shaders.getEffectChain()).toHaveLength(1);
      expect(shaders.getEffectChain()[0].type).toBe("pixelate");
    });

    it("round-trips through capture + restore", () => {
      scene.create({ id: "obj1", name: "obj1", type: "box", metadata: { width: 2 } });
      palettes.register({ name: "p1", colors: ["#abc"] });
      shaders.addEffect({ type: "outline", params: { thickness: 2 } });

      const captured = captureSession(scene, palettes, shaders);

      // Create fresh registries
      const scene2 = new SceneEngine();
      const palettes2 = new PaletteRegistry();
      const shaders2 = new ShaderRegistry();

      restoreSession(captured, scene2, palettes2, shaders2);

      expect(scene2.get("obj1")?.metadata.width).toBe(2);
      expect(palettes2.get("p1")?.colors).toEqual(["#abc"]);
      expect(shaders2.getEffectChain()).toHaveLength(1);
    });
  });
});
