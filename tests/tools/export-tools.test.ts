import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { registerExportTools } from "../../src/tools/builtin/export-tools.js";
import type { AtelierMcpServer } from "../../src/server/server.js";

// Minimal mock server with a mock bridge
function createMockServer() {
  const executeMock = vi.fn();
  const screenshotMock = vi.fn();

  const server = {
    registry: new ToolRegistry(),
    bridge: {
      execute: executeMock,
      getScreenshot: screenshotMock,
    },
  } as unknown as AtelierMcpServer;

  registerExportTools(server);

  return { server, executeMock, screenshotMock };
}

function callTool(server: AtelierMcpServer, name: string, args: Record<string, unknown>) {
  const tool = server.registry.get(name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool.handler({ toolName: name, args } as any);
}

function parseTextContent(result: any): any {
  const textContent = result.content?.find((c: any) => c.type === "text");
  if (!textContent) return null;
  return JSON.parse(textContent.text);
}

describe("export tools registration", () => {
  it("registers render_spritesheet, export_gltf, and export_metadata", () => {
    const { server } = createMockServer();
    expect(server.registry.has("render_spritesheet")).toBe(true);
    expect(server.registry.has("export_gltf")).toBe(true);
    expect(server.registry.has("export_metadata")).toBe(true);
  });
});

describe("render_spritesheet", () => {
  it("calls bridge with correct params and returns image + metadata", async () => {
    const { server, executeMock } = createMockServer();

    const mockMetadata = {
      frameCount: 8,
      cols: 4,
      rows: 2,
      frameWidth: 128,
      frameHeight: 128,
      sheetWidth: 512,
      sheetHeight: 256,
      frames: [
        { x: 0, y: 0, w: 128, h: 128 },
        { x: 128, y: 0, w: 128, h: 128 },
      ],
    };

    executeMock.mockResolvedValueOnce({
      image: "base64PngData",
      metadata: mockMetadata,
    });

    const result = (await callTool(server, "render_spritesheet", {
      frameCount: 8,
      cols: 4,
      frameWidth: 128,
      frameHeight: 128,
    })) as any;

    expect(executeMock).toHaveBeenCalledWith("renderSpritesheet", {
      frameCount: 8,
      cols: 4,
      frameWidth: 128,
      frameHeight: 128,
      animationClipId: undefined,
      objectId: undefined,
    });

    // Should have image content and text metadata
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe("image");
    expect(result.content[0].data).toBe("base64PngData");
    expect(result.content[0].mimeType).toBe("image/png");

    const meta = JSON.parse(result.content[1].text);
    expect(meta.status).toBe("rendered");
    expect(meta.frameCount).toBe(8);
    expect(meta.cols).toBe(4);
  });

  it("passes clipId and objectId when provided", async () => {
    const { server, executeMock } = createMockServer();

    executeMock.mockResolvedValueOnce({
      image: "img",
      metadata: {
        frameCount: 4,
        cols: 2,
        rows: 2,
        frameWidth: 64,
        frameHeight: 64,
        sheetWidth: 128,
        sheetHeight: 128,
        frames: [],
      },
    });

    await callTool(server, "render_spritesheet", {
      frameCount: 4,
      cols: 2,
      frameWidth: 64,
      frameHeight: 64,
      clipId: "walk_cycle",
      objectId: "character_01",
    });

    expect(executeMock).toHaveBeenCalledWith("renderSpritesheet", {
      frameCount: 4,
      cols: 2,
      frameWidth: 64,
      frameHeight: 64,
      animationClipId: "walk_cycle",
      objectId: "character_01",
    });
  });
});

describe("export_gltf", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `atelier-test-${Date.now()}`);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes GLB file to disk", async () => {
    const { server, executeMock } = createMockServer();

    // Simulate a small GLB file as base64
    const sampleBytes = Buffer.from("glTF mock binary data");
    const base64 = sampleBytes.toString("base64");
    executeMock.mockResolvedValueOnce(base64);

    const outputFile = path.join(tmpDir, "model.glb");
    const result = await callTool(server, "export_gltf", {
      filename: outputFile,
    });

    // Verify bridge call
    expect(executeMock).toHaveBeenCalledWith("exportGltf", {
      objectId: undefined,
    });

    // Verify file written
    const written = await readFile(outputFile);
    expect(written.toString()).toBe("glTF mock binary data");

    // Verify response
    const data = parseTextContent(result);
    expect(data.status).toBe("exported");
    expect(data.path).toBe(outputFile);
    expect(data.sizeBytes).toBe(sampleBytes.length);
    expect(data.format).toBe("glb");
  });

  it("appends .glb extension if missing", async () => {
    const { server, executeMock } = createMockServer();

    executeMock.mockResolvedValueOnce(Buffer.from("data").toString("base64"));

    const outputFile = path.join(tmpDir, "model");
    const result = await callTool(server, "export_gltf", {
      filename: outputFile,
    });

    const data = parseTextContent(result);
    expect(data.path).toBe(`${outputFile}.glb`);

    // Verify file exists at appended path
    const fileStat = await stat(`${outputFile}.glb`);
    expect(fileStat.isFile()).toBe(true);
  });

  it("passes objectId to bridge when provided", async () => {
    const { server, executeMock } = createMockServer();

    executeMock.mockResolvedValueOnce(Buffer.from("x").toString("base64"));

    await callTool(server, "export_gltf", {
      filename: path.join(tmpDir, "obj.glb"),
      objectId: "my_mesh",
    });

    expect(executeMock).toHaveBeenCalledWith("exportGltf", {
      objectId: "my_mesh",
    });
  });
});

describe("export_metadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `atelier-meta-test-${Date.now()}`);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates Godot .tres SpriteFrames format", async () => {
    const { server } = createMockServer();

    const outputFile = path.join(tmpDir, "sprite.tres");
    const result = await callTool(server, "export_metadata", {
      format: "godot_tres",
      spritesheet: {
        frameCount: 4,
        cols: 2,
        frameWidth: 64,
        frameHeight: 64,
        filename: "spritesheet.png",
      },
      outputPath: outputFile,
    });

    const data = parseTextContent(result);
    expect(data.status).toBe("written");
    expect(data.format).toBe("godot_tres");
    expect(data.path).toBe(outputFile);

    const content = await readFile(outputFile, "utf-8");
    expect(content).toContain('[gd_resource type="SpriteFrames"');
    expect(content).toContain('ExtResource("1_spritesheet")');
    expect(content).toContain('"name": &"default"');
    expect(content).toContain("res://spritesheet.png");
    // Should have 4 atlas sub-resources
    expect(content).toContain('id="atlas_0"');
    expect(content).toContain('id="atlas_3"');
    // Verify region coordinates for frame 3 (col=1, row=1)
    expect(content).toContain("Rect2(64, 64, 64, 64)");
  });

  it("generates JSON metadata format", async () => {
    const { server } = createMockServer();

    const outputFile = path.join(tmpDir, "sprite.json");
    const result = await callTool(server, "export_metadata", {
      format: "json",
      spritesheet: {
        frameCount: 6,
        cols: 3,
        frameWidth: 32,
        frameHeight: 32,
        filename: "sheet.png",
      },
      outputPath: outputFile,
    });

    const data = parseTextContent(result);
    expect(data.status).toBe("written");
    expect(data.format).toBe("json");

    const content = JSON.parse(await readFile(outputFile, "utf-8"));
    expect(content.image).toBe("sheet.png");
    expect(content.frameCount).toBe(6);
    expect(content.cols).toBe(3);
    expect(content.rows).toBe(2);
    expect(content.sheetWidth).toBe(96);
    expect(content.sheetHeight).toBe(64);
    expect(content.frames).toHaveLength(6);

    // Check frame 5 (col=2, row=1)
    expect(content.frames[5]).toEqual({
      index: 5,
      x: 64,
      y: 32,
      width: 32,
      height: 32,
    });
  });

  it("uses default output path based on filename", async () => {
    const { server } = createMockServer();

    // Use CWD-relative default path — resolve it so we can clean up
    const result = await callTool(server, "export_metadata", {
      format: "json",
      spritesheet: {
        frameCount: 1,
        cols: 1,
        frameWidth: 16,
        frameHeight: 16,
        filename: path.join(tmpDir, "test_sheet.png"),
      },
    });

    const data = parseTextContent(result);
    // Should strip .png and add .json
    expect(data.path).toBe(path.resolve(path.join(tmpDir, "test_sheet.json")));

    // Clean up generated file
    await rm(data.path, { force: true });
  });
});
