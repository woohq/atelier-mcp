import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

export function registerMaterialTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "set_material",
    description:
      "Set material properties on a mesh object. Supports PBR properties: " +
      "color, metalness, roughness, emissive color and intensity, opacity, " +
      "wireframe, and flat shading.",
    schema: {
      objectId: z.string().describe("ID of the mesh object to modify"),
      color: z.string().optional().describe("Hex color string, e.g. '#ff0000'"),
      metalness: z.number().min(0).max(1).optional().describe("Metalness factor (0-1)"),
      roughness: z.number().min(0).max(1).optional().describe("Roughness factor (0-1)"),
      emissive: z.string().optional().describe("Emissive hex color string"),
      emissiveIntensity: z.number().min(0).optional().describe("Emissive intensity multiplier"),
      opacity: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Opacity (0-1, <1 enables transparency)"),
      wireframe: z.boolean().optional().describe("Enable wireframe rendering"),
      flatShading: z.boolean().optional().describe("Enable flat shading"),
    },
    handler: async (ctx) => {
      const { objectId, ...materialProps } = ctx.args;

      await server.bridge.execute("setMaterial", { objectId, ...materialProps });

      return makeTextResponse({
        objectId,
        material: materialProps,
        status: "applied",
      });
    },
  });

  server.registry.register({
    name: "set_palette",
    description:
      "Define a named color palette. Palettes are reusable sets of colors " +
      "that can be applied to objects via apply_palette. " +
      "Setting a palette also makes it the active palette.",
    schema: {
      name: z.string().describe("Palette name"),
      colors: z
        .array(z.string())
        .min(1)
        .describe("Array of hex color strings, e.g. ['#ff0000', '#00ff00']"),
    },
    handler: async (ctx) => {
      const { name, colors } = ctx.args;

      server.palettes.register({ name, colors });
      server.palettes.setActive(name);

      return makeTextResponse({
        palette: name,
        colorCount: colors.length,
        active: true,
        status: "registered",
      });
    },
  });

  server.registry.register({
    name: "apply_palette",
    description:
      "Map objects to palette colors by index. For each mapping, resolves " +
      "the palette index to a hex color and sets it on the object's material.",
    schema: {
      mappings: z
        .array(
          z.object({
            objectId: z.string().describe("ID of the mesh object"),
            paletteIndex: z.number().int().min(0).describe("Index into the palette colors array"),
          }),
        )
        .min(1)
        .describe("Array of object-to-palette-index mappings"),
      palette: z
        .string()
        .optional()
        .describe("Palette name. Defaults to the active palette if not specified."),
    },
    handler: async (ctx) => {
      const { mappings, palette: paletteName } = ctx.args;
      const applied: Array<{ objectId: string; color: string; paletteIndex: number }> = [];

      for (const mapping of mappings) {
        const color = server.palettes.resolveColor(mapping.paletteIndex, paletteName);
        await server.bridge.execute("setMaterial", {
          objectId: mapping.objectId,
          color,
        });
        applied.push({
          objectId: mapping.objectId,
          color,
          paletteIndex: mapping.paletteIndex,
        });
      }

      return makeTextResponse({
        applied,
        palette: paletteName ?? server.palettes.getActive()?.name ?? null,
        status: "applied",
      });
    },
  });
}
