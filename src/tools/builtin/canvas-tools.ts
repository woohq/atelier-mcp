import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

export function registerCanvasTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "create_canvas",
    description:
      "Create a 2D drawing canvas for pixel art, shapes, and painting. " +
      "Must be called before any other 2D drawing tool. " +
      "Returns the canvas dimensions.",
    schema: {
      width: z.number().int().min(1).max(4096).describe("Canvas width in pixels"),
      height: z.number().int().min(1).max(4096).describe("Canvas height in pixels"),
      background: z
        .string()
        .optional()
        .describe("Background fill color (CSS color string, e.g. '#000000' or 'white')"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("createCanvas", ctx.args);
      return makeTextResponse(result);
    },
  });

  server.registry.register({
    name: "draw_shape",
    description:
      "Draw a 2D shape (rect, circle, ellipse, or polygon) on the active layer. " +
      "Supports fill color, stroke color, and line width. " +
      "For polygon, provide an array of [x, y] points.",
    schema: {
      shape: z.enum(["rect", "circle", "ellipse", "polygon"]).describe("Shape type to draw"),
      x: z
        .number()
        .optional()
        .describe("X position (left edge for rect, center for circle/ellipse)"),
      y: z
        .number()
        .optional()
        .describe("Y position (top edge for rect, center for circle/ellipse)"),
      width: z.number().optional().describe("Width (rect only)"),
      height: z.number().optional().describe("Height (rect only)"),
      radius: z.number().optional().describe("Radius (circle only)"),
      radiusX: z.number().optional().describe("Horizontal radius (ellipse only)"),
      radiusY: z.number().optional().describe("Vertical radius (ellipse only)"),
      points: z
        .array(z.tuple([z.number(), z.number()]))
        .optional()
        .describe("Array of [x, y] points (polygon only)"),
      fill: z.string().optional().describe("Fill color (CSS color string)"),
      stroke: z.string().optional().describe("Stroke color (CSS color string)"),
      lineWidth: z.number().optional().describe("Stroke line width in pixels"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("drawShape", ctx.args);
      return makeTextResponse(result);
    },
  });

  server.registry.register({
    name: "draw_line",
    description:
      "Draw a line or polyline through a series of points on the active layer. " +
      "Provide at least 2 points as [x, y] pairs.",
    schema: {
      points: z
        .array(z.tuple([z.number(), z.number()]))
        .min(2)
        .describe("Array of [x, y] points to connect"),
      color: z.string().optional().describe("Line color (CSS color string, default '#ffffff')"),
      width: z.number().optional().describe("Line width in pixels (default 1)"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("drawLine", ctx.args);
      return makeTextResponse(result);
    },
  });

  server.registry.register({
    name: "fill",
    description:
      "Flood fill from a point on the active layer. " +
      "Replaces all connected pixels of the same color as the target point with the new color. " +
      "Useful for filling enclosed regions.",
    schema: {
      x: z.number().int().describe("X coordinate of the fill starting point"),
      y: z.number().int().describe("Y coordinate of the fill starting point"),
      color: z.string().describe("Fill color (CSS color string, e.g. '#ff0000')"),
      tolerance: z
        .number()
        .int()
        .min(0)
        .max(255)
        .optional()
        .describe("Color match tolerance (0-255, default 0 for exact match)"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("floodFill", ctx.args);
      return makeTextResponse(result);
    },
  });

  server.registry.register({
    name: "set_pixel",
    description:
      "Set individual pixels on the active layer. " +
      "Optimized for batch pixel art workflows — pass an array of {x, y, color} entries.",
    schema: {
      pixels: z
        .array(
          z.object({
            x: z.number().int().describe("X coordinate"),
            y: z.number().int().describe("Y coordinate"),
            color: z.string().describe("Pixel color (CSS color string)"),
          }),
        )
        .min(1)
        .describe("Array of pixels to set"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("setPixel", ctx.args);
      return makeTextResponse(result);
    },
  });

  server.registry.register({
    name: "create_layer",
    description:
      "Create a new drawing layer and make it the active target for draw commands. " +
      "Layers are composited in order when blend_layers is called. " +
      "Supports opacity and CSS blend modes (e.g. 'multiply', 'screen', 'overlay').",
    schema: {
      name: z.string().describe("Layer name for identification"),
      opacity: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Layer opacity (0.0 to 1.0, default 1.0)"),
      blendMode: z
        .string()
        .optional()
        .describe(
          "CSS blend mode (e.g. 'source-over', 'multiply', 'screen', 'overlay', default 'source-over')",
        ),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("createLayer", ctx.args);
      return makeTextResponse(result);
    },
  });

  server.registry.register({
    name: "blend_layers",
    description:
      "Composite all layers onto the main canvas in order. " +
      "Each layer is drawn with its configured opacity and blend mode. " +
      "Call this after drawing on layers to produce the final image.",
    schema: {},
    handler: async (ctx) => {
      const result = await server.bridge.execute("blendLayers", ctx.args);
      return makeTextResponse(result);
    },
  });

  server.registry.register({
    name: "palette_swap",
    description:
      "Replace all pixels of one color with another on the active layer. " +
      "Useful for recoloring sprites or applying palette variations. " +
      "Colors are matched with an optional tolerance.",
    schema: {
      sourceColor: z.string().describe("Color to replace (CSS color string, e.g. '#ff0000')"),
      targetColor: z.string().describe("Replacement color (CSS color string, e.g. '#00ff00')"),
      tolerance: z
        .number()
        .int()
        .min(0)
        .max(255)
        .optional()
        .describe("Color match tolerance (0-255, default 0 for exact match)"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("paletteSwap", ctx.args);
      return makeTextResponse(result);
    },
  });
}
