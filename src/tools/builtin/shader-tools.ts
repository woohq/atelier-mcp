import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

export function registerShaderTools(server: AtelierMcpServer): void {
  // --- apply_post_process ---
  server.registry.register({
    name: "apply_post_process",
    description:
      "Apply a post-processing effect to the rendered image. Effects are chained in " +
      "application order. Types: pixelate (retro pixel look), cel_shade (toon quantized " +
      "lighting), dither (Bayer matrix dithering), palette_quantize (snap colors to a " +
      "palette), outline (Sobel edge detection), bloom (glow on bright areas), " +
      "vignette (darken edges), chromatic_aberration (RGB channel offset), " +
      "film_grain (animated noise), halftone (comic book dots), color_grade " +
      "(brightness/contrast/saturation), sharpen (unsharp mask), invert (negative), " +
      "edge_glow (neon edge effect), crosshatch (hatching shading), " +
      "watercolor (painterly effect).",
    schema: {
      effect: z
        .enum([
          "pixelate",
          "cel_shade",
          "dither",
          "palette_quantize",
          "outline",
          "bloom",
          "vignette",
          "chromatic_aberration",
          "film_grain",
          "halftone",
          "color_grade",
          "sharpen",
          "invert",
          "edge_glow",
          "crosshatch",
          "watercolor",
        ])
        .describe("Post-processing effect type"),
      params: z
        .record(z.unknown())
        .optional()
        .describe(
          "Effect parameters. pixelate: { pixelSize: number }. cel_shade: { steps: number }. " +
            "dither: { strength: number, matrixSize: number }. " +
            "palette_quantize: { palette: number[][], paletteSize: number }. " +
            "outline: { thickness: number, color: [r,g,b] (0-1 floats), threshold: number (0-1, default 0.1), sensitivity: number (default 1.0) }. " +
            "bloom: { threshold: number (default 0.5), intensity: number (default 1.0) }. " +
            "vignette: { intensity: number (default 0.5), smoothness: number (default 0.5) }. " +
            "chromatic_aberration: { offset: number (default 0.005) }. " +
            "film_grain: { intensity: number (default 0.3) }. " +
            "halftone: { dotSize: number (default 4.0) }. " +
            "color_grade: { brightness: number (default 0), contrast: number (default 1), saturation: number (default 1) }. " +
            "sharpen: { strength: number (default 0.5) }. " +
            "invert: no params. " +
            "edge_glow: { threshold: number (default 0.3), color: [r,g,b] (0-1 floats, default [0,1,1]), intensity: number (default 1.5) }. " +
            "crosshatch: { spacing: number (default 8.0), angle: number (default 0.785), weight: number (default 1.0) }. " +
            "watercolor: { wetness: number (default 0.5), bleed: number (default 0.5), granulation: number (default 0.3) }.",
        ),
    },
    handler: async (ctx) => {
      const { effect, params } = ctx.args;
      const entry = server.shaders.addEffect({
        type: effect,
        params: params ?? {},
      });
      await server.bridge.execute("applyPostProcess", {
        id: entry.id,
        type: effect,
        params: params ?? {},
      });
      return makeTextResponse({ id: entry.id, type: effect, order: entry.order });
    },
  });

  // --- clear_post_process ---
  server.registry.register({
    name: "clear_post_process",
    description:
      "Remove post-processing effects. Pass an effectId to remove a single effect, " +
      "or omit it to remove all effects.",
    schema: {
      effectId: z
        .string()
        .optional()
        .describe("ID of a specific effect to remove. Omit to clear all."),
    },
    handler: async (ctx) => {
      const { effectId } = ctx.args;
      if (effectId) {
        const removed = server.shaders.removeEffect(effectId);
        if (!removed) {
          return makeTextResponse({ error: `Effect "${effectId}" not found` });
        }
        await server.bridge.execute("removePostProcess", { id: effectId });
        return makeTextResponse({ removed: effectId });
      }
      server.shaders.clearEffects();
      await server.bridge.execute("clearPostProcess", {});
      return makeTextResponse({ cleared: true });
    },
  });

  // --- write_shader ---
  server.registry.register({
    name: "write_shader",
    description:
      "Create a custom post-processing shader from raw GLSL. The fragment shader receives " +
      "'tDiffuse' (sampler2D of the previous pass) and 'vUv' (varying vec2). " +
      "Returns the shader ID on success, or compile errors to fix.",
    schema: {
      name: z.string().min(1).describe("Human-readable shader name"),
      fragmentShader: z.string().min(1).describe("GLSL fragment shader source"),
      vertexShader: z
        .string()
        .optional()
        .describe("GLSL vertex shader source (default passthrough)"),
      uniforms: z
        .record(z.object({ type: z.string(), value: z.unknown() }))
        .optional()
        .describe("Uniform definitions: { name: { type, value } }"),
    },
    handler: async (ctx) => {
      const { name, fragmentShader, vertexShader, uniforms } = ctx.args;
      const id = `shader_${name}`;
      try {
        await server.bridge.execute("writeShader", {
          id,
          fragmentShader,
          vertexShader,
          uniforms,
        });
        server.shaders.registerShader({
          id,
          name,
          fragmentShader,
          vertexShader: vertexShader ?? "",
          uniforms: uniforms ?? {},
        });
        return makeTextResponse({ id, status: "compiled" });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return makeTextResponse({
          error: `Shader compile error: ${message}`,
          hint: "Fix the GLSL and try again.",
        });
      }
    },
  });

  // --- set_uniform ---
  server.registry.register({
    name: "set_uniform",
    description:
      "Update a uniform value on an existing custom shader. The shader must have been " +
      "created with write_shader first.",
    schema: {
      shaderId: z.string().describe("ID of the shader (shader_<name>)"),
      uniformName: z.string().describe("Name of the uniform to update"),
      value: z.unknown().describe("New value for the uniform"),
    },
    handler: async (ctx) => {
      const { shaderId, uniformName, value } = ctx.args;
      try {
        server.shaders.updateUniform(shaderId, uniformName, value);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return makeTextResponse({ error: message });
      }
      await server.bridge.execute("setUniform", { shaderId, uniformName, value });
      return makeTextResponse({ shaderId, uniformName, updated: true });
    },
  });
}
