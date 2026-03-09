import { describe, it, expect, beforeEach } from "vitest";
import { ShaderRegistry } from "../../src/engine/shader-registry.js";

describe("ShaderRegistry", () => {
  let registry: ShaderRegistry;

  beforeEach(() => {
    registry = new ShaderRegistry();
  });

  describe("effects", () => {
    it("adds an effect with auto-generated ID and incremented order", () => {
      const effect = registry.addEffect({ type: "pixelate", params: { pixelSize: 4 } });
      expect(effect.id).toBe("fx_pixelate_0");
      expect(effect.type).toBe("pixelate");
      expect(effect.order).toBe(0);
      expect(effect.params).toEqual({ pixelSize: 4 });
    });

    it("adds an effect with explicit ID", () => {
      const effect = registry.addEffect({
        id: "my_effect",
        type: "cel_shade",
        params: { steps: 6 },
      });
      expect(effect.id).toBe("my_effect");
    });

    it("maintains insertion order via getEffectChain", () => {
      registry.addEffect({ type: "pixelate", params: {} });
      registry.addEffect({ type: "cel_shade", params: {} });
      registry.addEffect({ type: "outline", params: {} });

      const chain = registry.getEffectChain();
      expect(chain).toHaveLength(3);
      expect(chain[0].type).toBe("pixelate");
      expect(chain[1].type).toBe("cel_shade");
      expect(chain[2].type).toBe("outline");
      expect(chain[0].order).toBeLessThan(chain[1].order);
      expect(chain[1].order).toBeLessThan(chain[2].order);
    });

    it("removes an effect by ID", () => {
      const effect = registry.addEffect({ type: "dither", params: {} });
      expect(registry.removeEffect(effect.id)).toBe(true);
      expect(registry.effectCount()).toBe(0);
    });

    it("returns false when removing non-existent effect", () => {
      expect(registry.removeEffect("nonexistent")).toBe(false);
    });

    it("clears all effects and resets order counter", () => {
      registry.addEffect({ type: "pixelate", params: {} });
      registry.addEffect({ type: "cel_shade", params: {} });
      registry.clearEffects();
      expect(registry.effectCount()).toBe(0);
      expect(registry.getEffectChain()).toEqual([]);

      // Order should reset
      const effect = registry.addEffect({ type: "outline", params: {} });
      expect(effect.order).toBe(0);
    });

    it("gets a specific effect by ID", () => {
      const effect = registry.addEffect({ id: "test_fx", type: "pixelate", params: {} });
      expect(registry.getEffect("test_fx")).toEqual(effect);
      expect(registry.getEffect("nonexistent")).toBeUndefined();
    });

    it("preserves effect chain order after removal", () => {
      const a = registry.addEffect({ type: "pixelate", params: {} });
      registry.addEffect({ type: "cel_shade", params: {} });
      const c = registry.addEffect({ type: "outline", params: {} });

      registry.removeEffect(a.id);
      const chain = registry.getEffectChain();
      expect(chain).toHaveLength(2);
      expect(chain[0].type).toBe("cel_shade");
      expect(chain[1].type).toBe("outline");
      expect(chain[1].id).toBe(c.id);
    });
  });

  describe("custom shaders", () => {
    const testShader = {
      id: "shader_test",
      name: "test",
      fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      vertexShader: "",
      uniforms: {
        brightness: { type: "float", value: 1.0 },
        tint: { type: "vec3", value: [1, 0, 0] },
      },
    };

    it("registers and retrieves a custom shader", () => {
      registry.registerShader(testShader);
      const retrieved = registry.getShader("shader_test");
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe("test");
      expect(retrieved!.fragmentShader).toContain("gl_FragColor");
    });

    it("returns undefined for unknown shader", () => {
      expect(registry.getShader("nonexistent")).toBeUndefined();
    });

    it("updates a uniform value", () => {
      registry.registerShader(testShader);
      registry.updateUniform("shader_test", "brightness", 0.5);
      const shader = registry.getShader("shader_test")!;
      expect(shader.uniforms.brightness.value).toBe(0.5);
      // Type should be preserved
      expect(shader.uniforms.brightness.type).toBe("float");
    });

    it("throws when updating uniform on unknown shader", () => {
      expect(() => registry.updateUniform("nope", "x", 1)).toThrow('Shader "nope" not found');
    });

    it("throws when updating unknown uniform", () => {
      registry.registerShader(testShader);
      expect(() => registry.updateUniform("shader_test", "unknown_uniform", 1)).toThrow(
        'Uniform "unknown_uniform" not found on shader "shader_test"',
      );
    });

    it("lists all shaders", () => {
      registry.registerShader(testShader);
      registry.registerShader({
        ...testShader,
        id: "shader_other",
        name: "other",
      });
      expect(registry.listCustomShaders()).toHaveLength(2);
    });

    it("removes a shader", () => {
      registry.registerShader(testShader);
      expect(registry.removeShader("shader_test")).toBe(true);
      expect(registry.getShader("shader_test")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("clears both effects and shaders", () => {
      registry.addEffect({ type: "pixelate", params: {} });
      registry.registerShader({
        id: "s",
        name: "s",
        fragmentShader: "",
        vertexShader: "",
        uniforms: {},
      });

      registry.clear();
      expect(registry.effectCount()).toBe(0);
      expect(registry.getEffectChain()).toEqual([]);
      expect(registry.listCustomShaders()).toEqual([]);
    });
  });
});
