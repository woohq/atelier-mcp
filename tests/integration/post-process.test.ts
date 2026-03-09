import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShaderRegistry } from "../../src/engine/shader-registry.js";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { registerShaderTools } from "../../src/tools/builtin/shader-tools.js";
import { parseToolResult } from "../helpers.js";

/**
 * Integration tests for the post-processing pipeline.
 *
 * These tests validate the server-side shader registry interactions and verify
 * that bridge commands are issued correctly for each effect type. The actual
 * rendering (OutputPass fix, linear-to-sRGB conversion) is validated in the
 * preview page itself; here we confirm the orchestration is correct.
 */

function createMockServer() {
  const bridgeCalls: Array<{ command: string; params: Record<string, unknown> }> = [];
  const bridge = {
    execute: vi.fn(async (command: string, params: Record<string, unknown>) => {
      bridgeCalls.push({ command, params });
      return {};
    }),
  };
  const server = {
    registry: new ToolRegistry(),
    shaders: new ShaderRegistry(),
    bridge,
  } as any;
  registerShaderTools(server);
  return { server, bridge, bridgeCalls };
}

async function invoke(server: any, toolName: string, args: Record<string, unknown>) {
  const tool = server.registry.get(toolName);
  if (!tool) throw new Error(`Tool "${toolName}" not registered`);
  return tool.handler({ toolName, args });
}

describe("post-processing pipeline integration", () => {
  let server: any;
  let bridge: any;
  let bridgeCalls: Array<{ command: string; params: Record<string, unknown> }>;

  beforeEach(() => {
    ({ server, bridge, bridgeCalls } = createMockServer());
  });

  describe("effect types produce valid bridge commands", () => {
    const effectTypes = [
      { effect: "pixelate", params: { pixelSize: 8 } },
      { effect: "cel_shade", params: { steps: 4 } },
      { effect: "dither", params: { strength: 0.5, matrixSize: 4 } },
      { effect: "outline", params: { thickness: 2, color: [0, 0, 0] } },
      {
        effect: "palette_quantize",
        params: {
          palette: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          paletteSize: 4,
        },
      },
    ];

    for (const { effect, params } of effectTypes) {
      it(`apply_post_process with "${effect}" sends correct bridge command`, async () => {
        const result = await invoke(server, "apply_post_process", { effect, params });
        const { data } = parseToolResult(result);

        expect(data.type).toBe(effect);
        expect(data.id).toBeDefined();
        expect(server.shaders.effectCount()).toBe(1);

        // Verify bridge received applyPostProcess command
        expect(bridge.execute).toHaveBeenCalledWith("applyPostProcess", {
          id: data.id,
          type: effect,
          params,
        });
      });
    }
  });

  describe("effect chain ordering", () => {
    it("maintains insertion order for multiple effects", async () => {
      await invoke(server, "apply_post_process", {
        effect: "pixelate",
        params: { pixelSize: 4 },
      });
      await invoke(server, "apply_post_process", {
        effect: "cel_shade",
        params: { steps: 3 },
      });
      await invoke(server, "apply_post_process", {
        effect: "outline",
        params: { thickness: 1 },
      });

      const chain = server.shaders.getEffectChain();
      expect(chain).toHaveLength(3);
      expect(chain[0].type).toBe("pixelate");
      expect(chain[1].type).toBe("cel_shade");
      expect(chain[2].type).toBe("outline");

      // All three should have resulted in applyPostProcess bridge calls
      const applyPostProcessCalls = bridgeCalls.filter(
        (c) => c.command === "applyPostProcess",
      );
      expect(applyPostProcessCalls).toHaveLength(3);
    });

    it("preserves remaining effects after removing one from the middle", async () => {
      const r1 = await invoke(server, "apply_post_process", {
        effect: "pixelate",
        params: {},
      });
      await invoke(server, "apply_post_process", { effect: "cel_shade", params: {} });
      const r3 = await invoke(server, "apply_post_process", {
        effect: "outline",
        params: {},
      });

      const { data: d1 } = parseToolResult(r1);

      // Remove the first effect
      await invoke(server, "clear_post_process", { effectId: d1.id });

      expect(server.shaders.effectCount()).toBe(2);
      const chain = server.shaders.getEffectChain();
      expect(chain[0].type).toBe("cel_shade");
      expect(chain[1].type).toBe("outline");

      // Bridge should have received removePostProcess
      expect(bridge.execute).toHaveBeenCalledWith("removePostProcess", { id: d1.id });
    });
  });

  describe("clear_post_process resets everything", () => {
    it("clears all effects and calls bridge clearPostProcess", async () => {
      await invoke(server, "apply_post_process", {
        effect: "pixelate",
        params: { pixelSize: 8 },
      });
      await invoke(server, "apply_post_process", {
        effect: "outline",
        params: { thickness: 2 },
      });
      await invoke(server, "apply_post_process", {
        effect: "cel_shade",
        params: { steps: 3 },
      });

      expect(server.shaders.effectCount()).toBe(3);

      const result = await invoke(server, "clear_post_process", {});
      const { data } = parseToolResult(result);
      expect(data.cleared).toBe(true);
      expect(server.shaders.effectCount()).toBe(0);
      expect(bridge.execute).toHaveBeenCalledWith("clearPostProcess", {});
    });

    it("can add effects again after clearing", async () => {
      await invoke(server, "apply_post_process", {
        effect: "pixelate",
        params: { pixelSize: 4 },
      });
      await invoke(server, "clear_post_process", {});
      expect(server.shaders.effectCount()).toBe(0);

      const result = await invoke(server, "apply_post_process", {
        effect: "cel_shade",
        params: { steps: 5 },
      });
      const { data } = parseToolResult(result);
      expect(data.type).toBe("cel_shade");
      expect(server.shaders.effectCount()).toBe(1);
    });
  });

  describe("write_shader integration", () => {
    it("registers a custom shader and sends bridge command", async () => {
      const fragmentShader = [
        "uniform sampler2D tDiffuse;",
        "varying vec2 vUv;",
        "void main() {",
        "  vec4 color = texture2D(tDiffuse, vUv);",
        "  color.rgb = vec3(1.0) - color.rgb;",
        "  gl_FragColor = color;",
        "}",
      ].join("\n");

      const result = await invoke(server, "write_shader", {
        name: "invert",
        fragmentShader,
      });
      const { data } = parseToolResult(result);
      expect(data.id).toBe("shader_invert");
      expect(data.status).toBe("compiled");

      // Shader should be in the registry
      const shader = server.shaders.getShader("shader_invert");
      expect(shader).toBeDefined();
      expect(shader!.fragmentShader).toBe(fragmentShader);

      // Bridge should have been called with writeShader
      expect(bridge.execute).toHaveBeenCalledWith("writeShader", {
        id: "shader_invert",
        fragmentShader,
        vertexShader: undefined,
        uniforms: undefined,
      });
    });

    it("passes custom uniforms through to the bridge", async () => {
      const uniforms = {
        intensity: { type: "float", value: 0.75 },
        tint: { type: "vec3", value: [1.0, 0.5, 0.0] },
      };

      await invoke(server, "write_shader", {
        name: "tinted",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
        uniforms,
      });

      expect(bridge.execute).toHaveBeenCalledWith("writeShader", {
        id: "shader_tinted",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
        vertexShader: undefined,
        uniforms,
      });
    });
  });

  describe("set_uniform updates values", () => {
    it("updates a uniform and notifies the bridge", async () => {
      server.shaders.registerShader({
        id: "shader_test",
        name: "test",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
        vertexShader: "",
        uniforms: { brightness: { type: "float", value: 1.0 } },
      });

      const result = await invoke(server, "set_uniform", {
        shaderId: "shader_test",
        uniformName: "brightness",
        value: 0.5,
      });
      const { data } = parseToolResult(result);
      expect(data.updated).toBe(true);

      // Server-side value should be updated
      expect(server.shaders.getShader("shader_test")!.uniforms.brightness.value).toBe(0.5);

      // Bridge should be notified
      expect(bridge.execute).toHaveBeenCalledWith("setUniform", {
        shaderId: "shader_test",
        uniformName: "brightness",
        value: 0.5,
      });
    });
  });

  describe("full pipeline lifecycle", () => {
    it("add effects → modify uniform → clear all", async () => {
      // Step 1: Add pixelate effect
      const r1 = await invoke(server, "apply_post_process", {
        effect: "pixelate",
        params: { pixelSize: 8 },
      });
      const { data: d1 } = parseToolResult(r1);
      expect(d1.type).toBe("pixelate");

      // Step 2: Add a custom shader
      await invoke(server, "write_shader", {
        name: "custom_fx",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
        uniforms: { amount: { type: "float", value: 1.0 } },
      });
      expect(server.shaders.getShader("shader_custom_fx")).toBeDefined();

      // Step 3: Update the custom shader's uniform
      await invoke(server, "set_uniform", {
        shaderId: "shader_custom_fx",
        uniformName: "amount",
        value: 0.3,
      });
      expect(server.shaders.getShader("shader_custom_fx")!.uniforms.amount.value).toBe(0.3);

      // Step 4: Remove the pixelate effect
      await invoke(server, "clear_post_process", { effectId: d1.id });
      expect(server.shaders.effectCount()).toBe(0);

      // Step 5: Clear everything
      await invoke(server, "clear_post_process", {});

      // Verify bridge call sequence
      const commandNames = bridgeCalls.map((c) => c.command);
      expect(commandNames).toContain("applyPostProcess");
      expect(commandNames).toContain("writeShader");
      expect(commandNames).toContain("setUniform");
      expect(commandNames).toContain("removePostProcess");
      expect(commandNames).toContain("clearPostProcess");
    });
  });
});
