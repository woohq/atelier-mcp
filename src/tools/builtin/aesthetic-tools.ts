import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";
import { AtelierError, ErrorCode } from "../../types/errors.js";
import { logger } from "../../util/logger.js";

export interface PaletteEntry {
  name: string;
  colors: string[];
}

export function registerAestheticTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "load_aesthetic",
    description:
      "Load an aesthetic directory that provides domain-specific tools and palettes. " +
      "Unloads any previously loaded aesthetic first, then loads all plugin tools from " +
      "the aesthetic's tools/ subdirectory. Optionally loads palettes from palettes/ subdirectory. " +
      "Returns the list of newly available tools.",
    schema: {
      path: z.string().describe("Absolute or relative path to the aesthetic directory"),
    },
    handler: async (ctx) => {
      const aestheticPath = path.resolve(ctx.args.path as string);

      // Validate directory exists
      if (!fs.existsSync(aestheticPath) || !fs.statSync(aestheticPath).isDirectory()) {
        throw new AtelierError(
          ErrorCode.PLUGIN_LOAD_ERROR,
          `Aesthetic directory not found: ${aestheticPath}`,
        );
      }

      // Validate tools/ subdirectory exists
      const toolsDir = path.join(aestheticPath, "tools");
      if (!fs.existsSync(toolsDir) || !fs.statSync(toolsDir).isDirectory()) {
        throw new AtelierError(
          ErrorCode.PLUGIN_LOAD_ERROR,
          `Aesthetic directory missing required tools/ subdirectory: ${toolsDir}`,
        );
      }

      // Stop watching old directory
      server.plugins.stopWatching();

      // Unload all previously loaded plugin tools
      server.plugins.unloadAll();

      // Clear the scene
      server.scene.clear();

      // Load palettes if they exist
      const palettesDir = path.join(aestheticPath, "palettes");
      const loadedPalettes: string[] = [];
      if (fs.existsSync(palettesDir) && fs.statSync(palettesDir).isDirectory()) {
        const paletteFiles = fs.readdirSync(palettesDir).filter((f) => f.endsWith(".json"));

        for (const file of paletteFiles) {
          try {
            const raw = fs.readFileSync(path.join(palettesDir, file), "utf-8");
            const palette = JSON.parse(raw) as PaletteEntry;
            const paletteName = palette.name ?? path.basename(file, ".json");
            server.palettes.register({ name: paletteName, colors: palette.colors });
            loadedPalettes.push(paletteName);
            logger.debug("Loaded palette", { name: paletteName, colors: palette.colors.length });
          } catch (err) {
            logger.warn("Failed to load palette file", {
              file,
              error: String(err),
            });
          }
        }
      }

      // Load style presets from styles/ subdirectory
      const stylesDir = path.join(aestheticPath, "styles");
      const loadedStyles: string[] = [];
      if (fs.existsSync(stylesDir) && fs.statSync(stylesDir).isDirectory()) {
        const styleFiles = fs
          .readdirSync(stylesDir)
          .filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
        for (const file of styleFiles) {
          try {
            const mod = await import(
              `file://${path.join(stylesDir, file)}?t=${Date.now()}`
            );
            const style = mod.default;
            if (style && style.name && style.postProcess) {
              server.styles.register(style);
              loadedStyles.push(style.name);
              logger.debug("Loaded style preset", { name: style.name });
            }
          } catch (err) {
            logger.warn("Failed to load style file", {
              file,
              error: String(err),
            });
          }
        }
      }

      // Load plugin tools from tools/ subdirectory
      const loadedTools = await server.plugins.loadDirectory(toolsDir);

      // Start watching for hot reload
      server.plugins.watch(toolsDir);

      // Emit aesthetic:loaded event
      await server.events.emit("aesthetic:loaded", { path: aestheticPath });

      logger.info("Aesthetic loaded", {
        path: aestheticPath,
        tools: loadedTools,
        palettes: loadedPalettes,
        styles: loadedStyles,
      });

      return makeTextResponse({
        aesthetic: aestheticPath,
        tools: loadedTools,
        palettes: loadedPalettes,
        styles: loadedStyles,
      });
    },
  });
}
