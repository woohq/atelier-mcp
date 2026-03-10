import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import {
  composeMiddleware,
  loggingMiddleware,
  timingMiddleware,
  createTimeoutMiddleware,
  createErrorHandlingMiddleware,
} from "./middleware.js";
import type { ToolHandler } from "./middleware.js";
import { EventBus } from "./event-bus.js";
import { BrowserBridge } from "../bridge/browser-bridge.js";
import { SceneEngine } from "../engine/scene-engine.js";
import { ShaderRegistry } from "../engine/shader-registry.js";
import { PaletteRegistry } from "../engine/palette-registry.js";
import { SHIPPED_PALETTES } from "../engine/shipped-palettes.js";
import { SkeletonRegistry } from "../animation/skeleton.js";
import { AnimationClipRegistry } from "../animation/animation-clip.js";
import { PluginLoader } from "../plugins/plugin-loader.js";
import type { AtelierContext, BoundingBox } from "../plugins/define-tool.js";
import { CommandHistory } from "../engine/command-history.js";
import { StylePresetRegistry } from "../styles/style-preset-registry.js";
import { SeededRNG } from "../util/rng.js";
import { logger } from "../util/logger.js";
import { registerBuiltinTools } from "../tools/builtin/index.js";
import { createUndoMiddleware } from "./undo-middleware.js";
import { installSymmetryMiddleware } from "./symmetry-middleware.js";

export interface AtelierServerOptions {
  previewUrl?: string;
  toolTimeoutMs?: number;
}

export class AtelierMcpServer {
  readonly mcp: McpServer;
  readonly registry: ToolRegistry;
  readonly events: EventBus;
  readonly bridge: BrowserBridge;
  readonly scene: SceneEngine;
  readonly shaders: ShaderRegistry;
  readonly palettes: PaletteRegistry;
  readonly skeletons: SkeletonRegistry;
  readonly animations: AnimationClipRegistry;
  readonly plugins: PluginLoader;
  readonly history: CommandHistory;
  readonly styles: StylePresetRegistry;

  constructor(options: AtelierServerOptions = {}) {
    this.mcp = new McpServer({
      name: "atelier-mcp",
      version: "0.1.0",
    });
    this.registry = new ToolRegistry();
    this.events = new EventBus();
    this.bridge = new BrowserBridge(options.previewUrl);
    this.scene = new SceneEngine();
    this.shaders = new ShaderRegistry();
    this.palettes = new PaletteRegistry();
    this.skeletons = new SkeletonRegistry();
    this.animations = new AnimationClipRegistry();

    this.history = new CommandHistory();
    this.styles = new StylePresetRegistry();

    // Create plugin loader with AtelierContext factory
    const createContext = (): AtelierContext => ({
      invoke: async (name, args) => {
        const tool = this.registry.get(name);
        if (!tool) throw new Error(`Tool "${name}" not found`);
        return tool.handler({ toolName: name, args });
      },
      palette: (index, paletteName?) => {
        return this.palettes.resolveColor(index, paletteName);
      },
      getObject: (id) => this.scene.get(id),
      listObjects: () => this.scene.list(),
      clone: async (objectId) => {
        const obj = this.scene.get(objectId);
        if (!obj) throw new Error(`Object "${objectId}" not found`);
        const newId = this.scene.generateId("clone");
        this.scene.create({
          id: newId,
          name: newId,
          type: obj.type,
          metadata: { ...obj.metadata, clonedFrom: objectId },
        });
        await this.bridge.execute("cloneObject", { sourceId: objectId, newId });
        return newId;
      },
      group: async (name, fn) => {
        const groupId = this.scene.generateId("group");
        this.scene.create({ id: groupId, name, type: "group" });
        await this.bridge.execute("createGroup", { id: groupId, name });
        await fn(groupId);
        return groupId;
      },
      measure: async (objectId) => {
        const result = await this.bridge.execute("measureObject", { objectId });
        return result as BoundingBox;
      },
      render: async (options) => {
        const tool = this.registry.get("render_preview");
        if (!tool) throw new Error("render_preview tool not found");
        const result = await tool.handler({
          toolName: "render_preview",
          args: {
            width: options?.width ?? 1024,
            height: options?.height ?? 1024,
            mode: "3d",
            format: "png",
            quality: 92,
            transparent: false,
          },
        });
        return JSON.stringify(result);
      },
      random: (seed) => new SeededRNG(seed ?? Date.now()),
      activeStyle: () => this.styles.getActive(),
    });
    this.plugins = new PluginLoader(this.registry, this.events, createContext);

    // Load shipped palettes
    for (const palette of SHIPPED_PALETTES) {
      this.palettes.register(palette);
    }

    // Register built-in tools
    registerBuiltinTools(this);

    // Install symmetry middleware (wraps bridge.execute for auto-mirroring)
    installSymmetryMiddleware(this);

    // Wire tools to MCP with middleware
    const middlewares = [
      loggingMiddleware,
      timingMiddleware,
      createTimeoutMiddleware(options.toolTimeoutMs),
      createErrorHandlingMiddleware(),
      createUndoMiddleware(this),
    ];

    this.registry.wireToMcp(this.mcp, (handler: ToolHandler) =>
      composeMiddleware(handler, middlewares),
    );

    logger.info("Atelier MCP server initialized", {
      tools: this.registry.allNames(),
    });
  }

  async shutdown(): Promise<void> {
    this.plugins.stopWatching();
    this.plugins.unloadAll();
    await this.bridge.shutdown();
    await this.events.emit("server:stopped", { timestamp: Date.now() });
    logger.info("Atelier MCP server shut down");
  }
}
