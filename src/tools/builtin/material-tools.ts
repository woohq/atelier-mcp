import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { AtelierError, ErrorCode } from "../../types/errors.js";
import { makeTextResponse } from "../response.js";

// --- HSL color helpers ---

interface HSL {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

function hexToHsl(hex: string): HSL {
  const cleaned = hex.replace(/^#/, "");
  const r = parseInt(cleaned.substring(0, 2), 16) / 255;
  const g = parseInt(cleaned.substring(2, 4), 16) / 255;
  const b = parseInt(cleaned.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  } else if (max === g) {
    h = ((b - r) / d + 2) * 60;
  } else {
    h = ((r - g) / d + 4) * 60;
  }

  return { h, s, l };
}

function hslToHex(hsl: HSL): string {
  const { h, s, l } = hsl;

  if (s === 0) {
    const val = Math.round(l * 255);
    return `#${val.toString(16).padStart(2, "0")}${val.toString(16).padStart(2, "0")}${val.toString(16).padStart(2, "0")}`;
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;

  const rv = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
  const gv = Math.round(hue2rgb(p, q, hNorm) * 255);
  const bv = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);

  return `#${rv.toString(16).padStart(2, "0")}${gv.toString(16).padStart(2, "0")}${bv.toString(16).padStart(2, "0")}`;
}

function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

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

  // --- set_texture ---
  server.registry.register({
    name: "set_texture",
    description:
      "Apply a texture image to a mesh. Supports diffuse, normal, roughness, " +
      "and emissive map slots.",
    schema: {
      objectId: z.string().describe("ID of the mesh"),
      imageData: z.string().describe("Base64-encoded image data"),
      slot: z
        .enum(["diffuse", "normal", "roughness", "emissive"])
        .default("diffuse")
        .describe("Texture map slot"),
      repeat: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe("Texture repeat [u, v]"),
      offset: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe("Texture offset [u, v]"),
    },
    handler: async (ctx) => {
      const { objectId, ...rest } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj)
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      const result = await server.bridge.execute("setTexture", { objectId, ...rest });
      return makeTextResponse(result);
    },
  });

  // --- generate_texture ---
  server.registry.register({
    name: "generate_texture",
    description:
      "Generate a procedural texture. Types: noise, checker, gradient, brick. " +
      "Optionally apply directly to a mesh.",
    schema: {
      type: z.enum(["noise", "checker", "gradient", "brick"]).describe("Texture type"),
      resolution: z
        .number()
        .int()
        .min(16)
        .max(2048)
        .default(256)
        .describe("Texture resolution"),
      seed: z.number().optional().describe("Random seed"),
      objectId: z.string().optional().describe("If provided, apply texture to this mesh"),
      repeat: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe("Texture repeat [u, v]"),
      checkSize: z.number().optional().describe("Checker: square size in pixels"),
      direction: z
        .enum(["horizontal", "vertical"])
        .optional()
        .describe("Gradient direction"),
      brickWidth: z.number().optional().describe("Brick: width in pixels"),
      brickHeight: z.number().optional().describe("Brick: height in pixels"),
      mortarSize: z.number().optional().describe("Brick: mortar gap size"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("generateTexture", ctx.args);
      return makeTextResponse(result);
    },
  });

  // --- generate_palette ---
  server.registry.register({
    name: "generate_palette",
    description:
      "Generate a color palette using color theory from a base color. " +
      "Modes: complementary, analogous, triadic, split_complementary, monochromatic.",
    schema: {
      baseColor: z.string().describe("Base hex color string, e.g. '#3a7bd5'"),
      mode: z
        .enum(["complementary", "analogous", "triadic", "split_complementary", "monochromatic"])
        .describe("Color harmony mode"),
      count: z
        .number()
        .int()
        .min(2)
        .max(12)
        .default(5)
        .describe("Number of colors to generate"),
    },
    handler: async (ctx) => {
      const { baseColor, mode, count } = ctx.args;
      const base = hexToHsl(baseColor);
      const colors: string[] = [];

      switch (mode) {
        case "complementary": {
          for (let i = 0; i < count; i++) {
            const t = i / (count - 1);
            const h = normalizeHue(base.h + t * 180);
            colors.push(hslToHex({ h, s: base.s, l: base.l }));
          }
          break;
        }
        case "analogous": {
          const spread = 60;
          for (let i = 0; i < count; i++) {
            const offset = count === 1 ? 0 : (i / (count - 1)) * spread - spread / 2;
            const h = normalizeHue(base.h + offset);
            colors.push(hslToHex({ h, s: base.s, l: base.l }));
          }
          break;
        }
        case "triadic": {
          const keyHues = [base.h, normalizeHue(base.h + 120), normalizeHue(base.h + 240)];
          for (let i = 0; i < count; i++) {
            const t = (i / count) * keyHues.length;
            const idx = Math.floor(t) % keyHues.length;
            const nextIdx = (idx + 1) % keyHues.length;
            const frac = t - Math.floor(t);
            let h0 = keyHues[idx];
            let h1 = keyHues[nextIdx];
            if (h1 - h0 > 180) h0 += 360;
            if (h0 - h1 > 180) h1 += 360;
            const h = normalizeHue(h0 + (h1 - h0) * frac);
            colors.push(hslToHex({ h, s: base.s, l: base.l }));
          }
          break;
        }
        case "split_complementary": {
          const splitHues = [base.h, normalizeHue(base.h + 150), normalizeHue(base.h + 210)];
          for (let i = 0; i < count; i++) {
            const t = (i / count) * splitHues.length;
            const idx = Math.floor(t) % splitHues.length;
            const nextIdx = (idx + 1) % splitHues.length;
            const frac = t - Math.floor(t);
            let h0 = splitHues[idx];
            let h1 = splitHues[nextIdx];
            if (h1 - h0 > 180) h0 += 360;
            if (h0 - h1 > 180) h1 += 360;
            const h = normalizeHue(h0 + (h1 - h0) * frac);
            colors.push(hslToHex({ h, s: base.s, l: base.l }));
          }
          break;
        }
        case "monochromatic": {
          for (let i = 0; i < count; i++) {
            const l = count === 1 ? base.l : 0.15 + (0.7 * i) / (count - 1);
            colors.push(hslToHex({ h: base.h, s: base.s, l }));
          }
          break;
        }
      }

      const paletteName = `generated_${mode}`;
      server.palettes.register({ name: paletteName, colors });
      server.palettes.setActive(paletteName);

      return makeTextResponse({
        palette: paletteName,
        baseColor,
        mode,
        colors,
        count: colors.length,
        status: "generated",
      });
    },
  });

  // --- extract_palette ---
  server.registry.register({
    name: "extract_palette",
    description:
      "Extract dominant colors from the current scene by rendering and running k-means " +
      "clustering on pixel colors. Registers the result as a palette.",
    schema: {
      count: z
        .number()
        .int()
        .min(2)
        .max(16)
        .default(5)
        .describe("Number of dominant colors to extract"),
      width: z
        .number()
        .int()
        .min(16)
        .max(512)
        .default(256)
        .describe("Render width for analysis"),
      height: z
        .number()
        .int()
        .min(16)
        .max(512)
        .default(256)
        .describe("Render height for analysis"),
    },
    handler: async (ctx) => {
      const { count, width, height } = ctx.args;

      await server.bridge.execute("resize", { width, height });

      const colors = (await server.bridge.execute("extractPalette", { count })) as string[];

      const paletteName = "extracted";
      server.palettes.register({ name: paletteName, colors });
      server.palettes.setActive(paletteName);

      return makeTextResponse({
        palette: paletteName,
        colors,
        count: colors.length,
        status: "extracted",
      });
    },
  });
}
