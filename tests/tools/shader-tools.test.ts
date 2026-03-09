import { describe, it, expect, beforeEach, vi } from "vitest";
import { ShaderRegistry } from "../../src/engine/shader-registry.js";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { registerShaderTools } from "../../src/tools/builtin/shader-tools.js";
import { parseToolResult } from "../helpers.js";

/**
 * Minimal mock of AtelierMcpServer for shader tool tests.
 */
function createMockServer() {
  const bridge = {
    execute: vi.fn().mockResolvedValue({}),
  };
  const server = {
    registry: new ToolRegistry(),
    shaders: new ShaderRegistry(),
    bridge,
  } as any;
  registerShaderTools(server);
  return { server, bridge };
}

/** Invoke a tool by name with given args. */
async function invoke(server: any, toolName: string, args: Record<string, unknown>) {
  const tool = server.registry.get(toolName);
  if (!tool) throw new Error(`Tool "${toolName}" not registered`);
  return tool.handler({ toolName, args });
}

describe("shader-tools", () => {
  let server: any;
  let bridge: any;

  beforeEach(() => {
    ({ server, bridge } = createMockServer());
  });

  describe("apply_post_process", () => {
    it("registers all 4 shader tools", () => {
      const names = server.registry.allNames();
      expect(names).toContain("apply_post_process");
      expect(names).toContain("clear_post_process");
      expect(names).toContain("write_shader");
      expect(names).toContain("set_uniform");
    });

    it("adds an effect to the registry and calls bridge", async () => {
      const result = await invoke(server, "apply_post_process", {
        effect: "pixelate",
        params: { pixelSize: 8 },
      });
      const { data } = parseToolResult(result);
      expect(data.type).toBe("pixelate");
      expect(data.id).toBeDefined();
      expect(data.order).toBe(0);

      // Effect should be tracked server-side
      expect(server.shaders.effectCount()).toBe(1);

      // Bridge should have been called
      expect(bridge.execute).toHaveBeenCalledWith("applyPostProcess", {
        id: data.id,
        type: "pixelate",
        params: { pixelSize: 8 },
      });
    });

    it("chains multiple effects in order", async () => {
      await invoke(server, "apply_post_process", { effect: "pixelate", params: {} });
      await invoke(server, "apply_post_process", { effect: "outline", params: {} });

      const chain = server.shaders.getEffectChain();
      expect(chain).toHaveLength(2);
      expect(chain[0].type).toBe("pixelate");
      expect(chain[1].type).toBe("outline");
    });

    it("defaults params to empty object when omitted", async () => {
      const result = await invoke(server, "apply_post_process", { effect: "cel_shade" });
      const { data } = parseToolResult(result);
      expect(data.type).toBe("cel_shade");

      expect(bridge.execute).toHaveBeenCalledWith("applyPostProcess", {
        id: data.id,
        type: "cel_shade",
        params: {},
      });
    });
  });

  describe("clear_post_process", () => {
    it("clears all effects when no effectId given", async () => {
      await invoke(server, "apply_post_process", { effect: "pixelate", params: {} });
      await invoke(server, "apply_post_process", { effect: "outline", params: {} });

      const result = await invoke(server, "clear_post_process", {});
      const { data } = parseToolResult(result);
      expect(data.cleared).toBe(true);
      expect(server.shaders.effectCount()).toBe(0);
      expect(bridge.execute).toHaveBeenCalledWith("clearPostProcess", {});
    });

    it("removes a specific effect by ID", async () => {
      const r1 = await invoke(server, "apply_post_process", { effect: "pixelate", params: {} });
      await invoke(server, "apply_post_process", { effect: "outline", params: {} });

      const { data: d1 } = parseToolResult(r1);
      const result = await invoke(server, "clear_post_process", { effectId: d1.id });
      const { data } = parseToolResult(result);
      expect(data.removed).toBe(d1.id);
      expect(server.shaders.effectCount()).toBe(1);
      expect(bridge.execute).toHaveBeenCalledWith("removePostProcess", { id: d1.id });
    });

    it("returns error for unknown effectId", async () => {
      const result = await invoke(server, "clear_post_process", { effectId: "nonexistent" });
      const { data } = parseToolResult(result);
      expect(data.error).toContain("not found");
    });
  });

  describe("write_shader", () => {
    it("registers a custom shader and calls bridge", async () => {
      const fragmentShader = "void main() { gl_FragColor = vec4(1.0); }";
      const result = await invoke(server, "write_shader", {
        name: "test",
        fragmentShader,
      });
      const { data } = parseToolResult(result);
      expect(data.id).toBe("shader_test");
      expect(data.status).toBe("compiled");

      const shader = server.shaders.getShader("shader_test");
      expect(shader).toBeDefined();
      expect(shader!.fragmentShader).toBe(fragmentShader);

      expect(bridge.execute).toHaveBeenCalledWith("writeShader", {
        id: "shader_test",
        fragmentShader,
        vertexShader: undefined,
        uniforms: undefined,
      });
    });

    it("passes uniforms and vertex shader to bridge", async () => {
      const uniforms = { brightness: { type: "float", value: 0.5 } };
      const vertexShader = "void main() { gl_Position = vec4(0); }";
      await invoke(server, "write_shader", {
        name: "custom",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
        vertexShader,
        uniforms,
      });

      expect(bridge.execute).toHaveBeenCalledWith("writeShader", {
        id: "shader_custom",
        fragmentShader: expect.any(String),
        vertexShader,
        uniforms,
      });
    });

    it("returns compile error from bridge and does not register", async () => {
      bridge.execute.mockRejectedValueOnce(new Error("GLSL syntax error at line 1"));

      const result = await invoke(server, "write_shader", {
        name: "bad",
        fragmentShader: "this is not GLSL",
      });
      const { data } = parseToolResult(result);
      expect(data.error).toContain("Shader compile error");
      expect(data.error).toContain("GLSL syntax error");
      expect(data.hint).toContain("Fix the GLSL");

      // Should not be registered server-side
      expect(server.shaders.getShader("shader_bad")).toBeUndefined();
    });
  });

  describe("set_uniform", () => {
    it("updates a uniform on a registered shader", async () => {
      // Register a shader first
      server.shaders.registerShader({
        id: "shader_test",
        name: "test",
        fragmentShader: "",
        vertexShader: "",
        uniforms: { brightness: { type: "float", value: 1.0 } },
      });

      const result = await invoke(server, "set_uniform", {
        shaderId: "shader_test",
        uniformName: "brightness",
        value: 0.3,
      });
      const { data } = parseToolResult(result);
      expect(data.updated).toBe(true);
      expect(data.shaderId).toBe("shader_test");

      // Value should be updated server-side
      expect(server.shaders.getShader("shader_test")!.uniforms.brightness.value).toBe(0.3);

      // Bridge should be notified
      expect(bridge.execute).toHaveBeenCalledWith("setUniform", {
        shaderId: "shader_test",
        uniformName: "brightness",
        value: 0.3,
      });
    });

    it("returns error for unknown shader", async () => {
      const result = await invoke(server, "set_uniform", {
        shaderId: "nope",
        uniformName: "x",
        value: 1,
      });
      const { data } = parseToolResult(result);
      expect(data.error).toContain("not found");
    });

    it("returns error for unknown uniform", async () => {
      server.shaders.registerShader({
        id: "shader_test",
        name: "test",
        fragmentShader: "",
        vertexShader: "",
        uniforms: { brightness: { type: "float", value: 1.0 } },
      });

      const result = await invoke(server, "set_uniform", {
        shaderId: "shader_test",
        uniformName: "nonexistent",
        value: 1,
      });
      const { data } = parseToolResult(result);
      expect(data.error).toContain("not found");
    });
  });
});
