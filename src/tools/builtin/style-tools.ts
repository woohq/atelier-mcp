import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

export function registerStyleTools(server: AtelierMcpServer): void {
  // --- apply_style ---
  server.registry.register({
    name: "apply_style",
    description:
      "Apply a visual style preset. Sets palette, post-processing chain, camera defaults, " +
      "and material defaults. Use list_styles to see available presets. " +
      "Individual tool calls always override style defaults.",
    schema: {
      name: z.string().describe("Style preset name"),
    },
    handler: async (ctx) => {
      const { name } = ctx.args;
      const style = server.styles.get(name);
      if (!style) {
        return makeTextResponse({
          error: `Style "${name}" not found. Use list_styles to see available styles.`,
        });
      }

      // Register inline palette if provided
      if (style.inlinePalette) {
        server.palettes.register(style.inlinePalette);
        server.palettes.setActive(style.inlinePalette.name);
      } else if (style.palette) {
        const existing = server.palettes.get(style.palette);
        if (existing) {
          server.palettes.setActive(style.palette);
        }
      }

      // Clear existing post-process and apply style's chain
      server.shaders.clearEffects();
      await server.bridge.execute("clearPostProcess", {});

      for (const step of style.postProcess) {
        const entry = server.shaders.addEffect({
          type: step.type,
          params: step.params,
        });
        await server.bridge.execute("applyPostProcess", {
          id: entry.id,
          type: step.type,
          params: step.params,
        });
      }

      // Apply camera if specified
      if (style.camera) {
        await server.bridge.execute("setCamera", style.camera);
      }

      // Set active style
      server.styles.setActive(name);

      return makeTextResponse({
        style: name,
        description: style.description,
        postProcessSteps: style.postProcess.length,
        palette: style.inlinePalette?.name ?? style.palette ?? null,
        materialDefaults: style.materialDefaults ?? null,
      });
    },
  });

  // --- list_styles ---
  server.registry.register({
    name: "list_styles",
    description: "List all available visual style presets with descriptions.",
    schema: {},
    handler: async () => {
      const styles = server.styles.list();
      return makeTextResponse(
        styles.map((s) => ({
          name: s.name,
          description: s.description,
          postProcessSteps: s.postProcess.length,
          palette: s.inlinePalette?.name ?? s.palette ?? null,
        })),
      );
    },
  });
}
