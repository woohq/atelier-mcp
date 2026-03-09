import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeImageResponse, makeTextResponse } from "../response.js";

export function registerRenderPreview(server: AtelierMcpServer): void {
  server.registry.register({
    name: "render_preview",
    description:
      "Render the current scene and return a screenshot. " +
      "Use this to see what the scene looks like after making changes. " +
      "Returns a PNG or JPEG image.",
    schema: {
      width: z.number().int().min(64).max(4096).default(1024).describe("Render width in pixels"),
      height: z.number().int().min(64).max(4096).default(1024).describe("Render height in pixels"),
      mode: z
        .enum(["3d", "2d", "composite"])
        .default("3d")
        .describe("Render mode: 3d, 2d, or composite (2D overlaid on 3D)"),
      format: z.enum(["png", "jpeg"]).default("png").describe("Output image format"),
      quality: z
        .number()
        .int()
        .min(0)
        .max(100)
        .default(92)
        .describe("JPEG quality (0-100). Only used when format is jpeg."),
      transparent: z
        .boolean()
        .default(false)
        .describe("Render with transparent background (PNG only)"),
    },
    handler: async (ctx) => {
      const { width, height, mode, format, quality, transparent } = ctx.args;

      try {
        // Resize viewport if needed
        await server.bridge.execute("resize", { width, height });
        // Set render mode
        await server.bridge.execute("setRenderMode", { mode });
        // Render with format options
        const base64 = (await server.bridge.execute("renderPreview", {
          format,
          quality,
          transparent,
        })) as string;
        const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
        return makeImageResponse(base64, mimeType);
      } catch (err) {
        return makeTextResponse({
          error: `Render failed: ${err instanceof Error ? err.message : String(err)}`,
          hint: "The preview browser may not be running. It launches automatically on first tool call.",
        });
      }
    },
  });
}
