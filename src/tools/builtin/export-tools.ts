import path from "node:path";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeImageResponse, makeTextResponse } from "../response.js";
import { AtelierError, ErrorCode } from "../../types/errors.js";

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

  // --- render_turnaround ---
  server.registry.register({
    name: "render_turnaround",
    description:
      "Render the scene from multiple evenly-spaced rotation angles around the Y axis. " +
      "Returns all rendered images, useful for inspecting a model from all sides.",
    schema: {
      count: z
        .number()
        .int()
        .min(2)
        .max(36)
        .default(8)
        .describe("Number of views around the Y axis"),
      width: z.number().int().min(64).max(4096).default(512).describe("Render width in pixels"),
      height: z.number().int().min(64).max(4096).default(512).describe("Render height in pixels"),
    },
    handler: async (ctx) => {
      const { count, width, height } = ctx.args;

      await server.bridge.execute("resize", { width, height });

      const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
      const radius = 5;
      const elevation = 3;

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count;
        const x = radius * Math.cos(angle);
        const zPos = radius * Math.sin(angle);

        await server.bridge.execute("setCamera", {
          position: [x, elevation, zPos],
          lookAt: [0, 0, 0],
        });

        const base64 = (await server.bridge.execute("renderPreview", {
          format: "png",
          quality: 92,
          transparent: false,
        })) as string;

        images.push({ type: "image" as const, data: base64, mimeType: "image/png" });
      }

      return {
        content: [
          ...images,
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "rendered",
              count,
              width,
              height,
              angles: Array.from({ length: count }, (_, i) => Math.round((360 * i) / count)),
            }),
          },
        ],
      };
    },
  });

  // --- batch_export ---
  server.registry.register({
    name: "batch_export",
    description:
      "Export multiple objects individually. For each object, hides all others, " +
      "renders or exports the isolated object, then restores visibility.",
    schema: {
      format: z.enum(["glb", "png"]).describe("Export format"),
      namePrefix: z.string().default("export").describe("Prefix for exported file names"),
      objectIds: z
        .array(z.string())
        .optional()
        .describe("Specific object IDs to export. If omitted, exports the entire scene."),
    },
    handler: async (ctx) => {
      const { format, namePrefix, objectIds } = ctx.args;

      if (!objectIds || objectIds.length === 0) {
        if (format === "glb") {
          const base64 = (await server.bridge.execute("exportGltf", {})) as string;
          const buffer = Buffer.from(base64, "base64");
          const outputPath = path.resolve(`${namePrefix}.glb`);
          await writeFile(outputPath, buffer);
          return makeTextResponse({
            status: "exported",
            items: [{ name: `${namePrefix}.glb`, path: outputPath, sizeBytes: buffer.length }],
            format,
          });
        } else {
          await server.bridge.execute("resize", { width: 1024, height: 1024 });
          const base64 = (await server.bridge.execute("renderPreview", {
            format: "png",
            quality: 92,
            transparent: true,
          })) as string;
          const buffer = Buffer.from(base64, "base64");
          const outputPath = path.resolve(`${namePrefix}.png`);
          await writeFile(outputPath, buffer);
          return makeTextResponse({
            status: "exported",
            items: [{ name: `${namePrefix}.png`, path: outputPath, sizeBytes: buffer.length }],
            format,
          });
        }
      }

      const allObjects = server.scene.list();
      const allIds = allObjects.map((o) => o.id);
      const exported: Array<{ objectId: string; name: string; path: string; sizeBytes: number }> =
        [];

      for (const objectId of objectIds) {
        for (const id of allIds) {
          await server.bridge.execute("setObjectVisibility", {
            objectId: id,
            visible: id === objectId,
          });
        }

        const itemName = `${namePrefix}_${objectId}`;

        if (format === "glb") {
          const base64 = (await server.bridge.execute("exportGltf", { objectId })) as string;
          const buffer = Buffer.from(base64, "base64");
          const outputPath = path.resolve(`${itemName}.glb`);
          await writeFile(outputPath, buffer);
          exported.push({ objectId, name: `${itemName}.glb`, path: outputPath, sizeBytes: buffer.length });
        } else {
          await server.bridge.execute("resize", { width: 1024, height: 1024 });
          const base64 = (await server.bridge.execute("renderPreview", {
            format: "png",
            quality: 92,
            transparent: true,
          })) as string;
          const buffer = Buffer.from(base64, "base64");
          const outputPath = path.resolve(`${itemName}.png`);
          await writeFile(outputPath, buffer);
          exported.push({ objectId, name: `${itemName}.png`, path: outputPath, sizeBytes: buffer.length });
        }
      }

      for (const id of allIds) {
        await server.bridge.execute("setObjectVisibility", { objectId: id, visible: true });
      }

      return makeTextResponse({ status: "exported", items: exported, format, count: exported.length });
    },
  });

  // --- bake_normal_map ---
  server.registry.register({
    name: "bake_normal_map",
    description:
      "Bake a normal map for an object using orthographic MeshNormalMaterial rendering. " +
      "Returns the normal map as a PNG image.",
    schema: {
      objectId: z.string().describe("ID of the object to bake a normal map for"),
      resolution: z
        .number()
        .int()
        .min(64)
        .max(2048)
        .default(512)
        .describe("Output resolution in pixels (square)"),
    },
    handler: async (ctx) => {
      const { objectId, resolution } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const base64 = (await server.bridge.execute("bakeNormalMap", {
        objectId,
        resolution,
      })) as string;
      return makeImageResponse(base64, "image/png");
    },
  });

  // --- bake_ao ---
  server.registry.register({
    name: "bake_ao",
    description:
      "Bake an ambient occlusion map for an object using multi-sample hemisphere lighting. " +
      "Returns the AO map as a PNG image.",
    schema: {
      objectId: z.string().describe("ID of the object to bake AO for"),
      resolution: z
        .number()
        .int()
        .min(64)
        .max(2048)
        .default(512)
        .describe("Output resolution in pixels (square)"),
      samples: z
        .number()
        .int()
        .min(4)
        .max(128)
        .default(32)
        .describe("Number of light direction samples"),
    },
    handler: async (ctx) => {
      const { objectId, resolution, samples } = ctx.args;
      const obj = server.scene.get(objectId);
      if (!obj) {
        throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, `Object "${objectId}" not found`);
      }
      const base64 = (await server.bridge.execute("bakeAO", {
        objectId,
        resolution,
        samples,
      })) as string;
      return makeImageResponse(base64, "image/png");
    },
  });
}
