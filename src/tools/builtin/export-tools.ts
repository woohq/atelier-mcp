import path from "node:path";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

interface SpritesheetFrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SpritesheetMetadata {
  frameCount: number;
  cols: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  frames: SpritesheetFrameRect[];
}

function generateGodotTres(
  spritesheet: {
    frameCount: number;
    cols: number;
    frameWidth: number;
    frameHeight: number;
    filename: string;
  },
  speed = 10,
): string {
  const frames: string[] = [];
  for (let i = 0; i < spritesheet.frameCount; i++) {
    frames.push(`{\n"duration": 1.0,\n"texture": SubResource("atlas_${i}")\n}`);
  }

  // Build atlas sub-resources
  const subResources: string[] = [];
  for (let i = 0; i < spritesheet.frameCount; i++) {
    const col = i % spritesheet.cols;
    const row = Math.floor(i / spritesheet.cols);
    const x = col * spritesheet.frameWidth;
    const y = row * spritesheet.frameHeight;
    subResources.push(
      `[sub_resource type="AtlasTexture" id="atlas_${i}"]\n` +
        `atlas = ExtResource("1_spritesheet")\n` +
        `region = Rect2(${x}, ${y}, ${spritesheet.frameWidth}, ${spritesheet.frameHeight})`,
    );
  }

  return (
    `[gd_resource type="SpriteFrames" load_steps=${spritesheet.frameCount + 2} format=3]\n\n` +
    `[ext_resource type="Texture2D" path="res://${spritesheet.filename}" id="1_spritesheet"]\n\n` +
    subResources.join("\n\n") +
    "\n\n" +
    `[resource]\nanimations = [{\n` +
    `"frames": [${frames.join(", ")}],\n` +
    `"loop": true,\n` +
    `"name": &"default",\n` +
    `"speed": ${speed}.0\n` +
    `}]\n`
  );
}

function generateJsonMetadata(spritesheet: {
  frameCount: number;
  cols: number;
  frameWidth: number;
  frameHeight: number;
  filename: string;
}): object {
  const rows = Math.ceil(spritesheet.frameCount / spritesheet.cols);
  const sheetWidth = spritesheet.cols * spritesheet.frameWidth;
  const sheetHeight = rows * spritesheet.frameHeight;

  const frames: Array<{
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];

  for (let i = 0; i < spritesheet.frameCount; i++) {
    const col = i % spritesheet.cols;
    const row = Math.floor(i / spritesheet.cols);
    frames.push({
      index: i,
      x: col * spritesheet.frameWidth,
      y: row * spritesheet.frameHeight,
      width: spritesheet.frameWidth,
      height: spritesheet.frameHeight,
    });
  }

  return {
    image: spritesheet.filename,
    frameCount: spritesheet.frameCount,
    cols: spritesheet.cols,
    rows,
    frameWidth: spritesheet.frameWidth,
    frameHeight: spritesheet.frameHeight,
    sheetWidth,
    sheetHeight,
    frames,
  };
}

export function registerExportTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "render_spritesheet",
    description:
      "Render a sprite sheet from animation frames or camera rotation views. " +
      "If a clipId is provided, renders animation frames at evenly spaced times. " +
      "Otherwise, rotates the camera around the scene for each frame. " +
      "Returns the sprite sheet as a PNG image plus metadata with frame rects.",
    schema: {
      frameCount: z.number().int().min(1).max(256).describe("Number of frames to render"),
      cols: z.number().int().min(1).max(32).describe("Number of columns in the sprite sheet grid"),
      frameWidth: z.number().int().min(16).max(2048).describe("Width of each frame in pixels"),
      frameHeight: z.number().int().min(16).max(2048).describe("Height of each frame in pixels"),
      clipId: z
        .string()
        .optional()
        .describe("Animation clip ID. If omitted, renders rotation views instead."),
      objectId: z
        .string()
        .optional()
        .describe("Object ID to focus on. If omitted, renders the whole scene."),
    },
    handler: async (ctx) => {
      const { frameCount, cols, frameWidth, frameHeight, clipId, objectId } = ctx.args;

      const result = (await server.bridge.execute("renderSpritesheet", {
        frameCount,
        cols,
        frameWidth,
        frameHeight,
        animationClipId: clipId,
        objectId,
      })) as { image: string; metadata: SpritesheetMetadata };

      return {
        content: [
          { type: "image" as const, data: result.image, mimeType: "image/png" },
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "rendered",
                ...result.metadata,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  });

  server.registry.register({
    name: "export_gltf",
    description:
      "Export the scene or a specific object as a GLB (binary glTF) file. " +
      "Writes the file to disk and returns the file path and size.",
    schema: {
      objectId: z
        .string()
        .optional()
        .describe("Object ID to export. If omitted, exports the entire scene."),
      filename: z
        .string()
        .describe("Output filename or path. '.glb' extension is added if missing."),
    },
    handler: async (ctx) => {
      const { objectId, filename } = ctx.args;

      const base64 = (await server.bridge.execute("exportGltf", {
        objectId,
      })) as string;
      const buffer = Buffer.from(base64, "base64");
      const outputPath = path.resolve(filename.endsWith(".glb") ? filename : `${filename}.glb`);
      await writeFile(outputPath, buffer);

      return makeTextResponse({
        status: "exported",
        path: outputPath,
        sizeBytes: buffer.length,
        format: "glb",
      });
    },
  });

  server.registry.register({
    name: "export_metadata",
    description:
      "Generate and write sprite sheet metadata to disk. " +
      "Supports Godot SpriteFrames (.tres) format or generic JSON format " +
      "with frame rectangles and dimensions.",
    schema: {
      format: z
        .enum(["godot_tres", "json"])
        .describe(
          "Output format: 'godot_tres' for Godot SpriteFrames .tres, 'json' for generic JSON",
        ),
      spritesheet: z
        .object({
          frameCount: z.number().int().min(1).describe("Number of frames"),
          cols: z.number().int().min(1).describe("Number of columns"),
          frameWidth: z.number().int().min(1).describe("Width of each frame in pixels"),
          frameHeight: z.number().int().min(1).describe("Height of each frame in pixels"),
          filename: z
            .string()
            .describe("Sprite sheet image filename (used as reference in metadata)"),
        })
        .describe("Sprite sheet parameters"),
      outputPath: z
        .string()
        .optional()
        .describe(
          "Output file path. Defaults to '<spritesheet.filename>.tres' or '<spritesheet.filename>.json'",
        ),
    },
    handler: async (ctx) => {
      const { format, spritesheet, outputPath: userPath } = ctx.args;

      let content: string;
      let ext: string;

      if (format === "godot_tres") {
        content = generateGodotTres(spritesheet);
        ext = ".tres";
      } else {
        const meta = generateJsonMetadata(spritesheet);
        content = JSON.stringify(meta, null, 2);
        ext = ".json";
      }

      const baseName = spritesheet.filename.replace(/\.[^.]+$/, "");
      const outputFile = path.resolve(userPath ?? `${baseName}${ext}`);
      await writeFile(outputFile, content, "utf-8");

      return makeTextResponse({
        status: "written",
        path: outputFile,
        format,
        sizeBytes: Buffer.byteLength(content, "utf-8"),
      });
    },
  });
}
