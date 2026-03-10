import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export function registerImportTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "import_model",
    description:
      "Import a 3D model file (GLB, GLTF, OBJ, or STL) into the scene. " +
      "Reads the file from disk, sends to the browser for parsing. " +
      "Supports optional position, scale, and geometry merging.",
    schema: {
      path: z.string().describe("File path to the model (absolute or relative)"),
      format: z
        .enum(["glb", "gltf", "obj", "stl"])
        .optional()
        .describe("File format (auto-detected from extension if omitted)"),
      position: vec3Schema.optional().describe("Position [x, y, z]"),
      scale: z
        .union([z.number().positive(), vec3Schema])
        .optional()
        .describe("Uniform scale (number) or per-axis scale [x, y, z]"),
      mergeGeometry: z
        .boolean()
        .default(false)
        .describe("Merge all child geometries into a single mesh"),
    },
    handler: async (ctx) => {
      const { path: filePath, format: userFormat, position, scale, mergeGeometry } = ctx.args;

      const resolvedPath = path.resolve(filePath);
      const ext = path.extname(resolvedPath).toLowerCase().replace(".", "");
      const format = userFormat ?? ext;

      if (!["glb", "gltf", "obj", "stl"].includes(format)) {
        return makeTextResponse({ error: `Unsupported format: ${format}` });
      }

      const fileData = await readFile(resolvedPath);
      const base64 = fileData.toString("base64");

      const id = server.scene.generateId("import");
      server.scene.create({
        id,
        name: id,
        type: "imported_model",
        metadata: { source: resolvedPath, format },
      });

      const result = await server.bridge.execute("importModel", {
        id,
        data: base64,
        format,
        position,
        scale,
        mergeGeometry,
      });

      return makeTextResponse({
        id,
        source: resolvedPath,
        format,
        ...(result as object),
      });
    },
  });
}
