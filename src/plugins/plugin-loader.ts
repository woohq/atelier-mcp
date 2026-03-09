import fs from "node:fs";
import path from "node:path";
import { logger } from "../util/logger.js";
import { AtelierError, ErrorCode } from "../types/errors.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { EventBus } from "../server/event-bus.js";
import type { AtelierContext, PluginToolDefinition } from "./define-tool.js";

export class PluginLoader {
  private loadedPlugins = new Map<string, string>(); // name → file path
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private registry: ToolRegistry,
    private events: EventBus,
    private createContext: () => AtelierContext,
  ) {}

  async loadDirectory(dir: string): Promise<string[]> {
    const absDir = path.resolve(dir);

    if (!fs.existsSync(absDir)) {
      throw new AtelierError(ErrorCode.PLUGIN_LOAD_ERROR, `Plugin directory not found: ${absDir}`);
    }

    const entries = fs.readdirSync(absDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));

    const loaded: string[] = [];
    for (const entry of entries) {
      const filePath = path.join(absDir, entry);
      const name = await this.loadFile(filePath);
      if (name) {
        loaded.push(name);
      }
    }

    return loaded;
  }

  async loadFile(filePath: string): Promise<string | null> {
    const absPath = path.resolve(filePath);

    try {
      // Dynamic import with cache-bust to pick up changes
      const mod = await import(`file://${absPath}?t=${Date.now()}`);
      const def: PluginToolDefinition = mod.default;

      if (!def || !def.name || !def.description || !def.schema || !def.handler) {
        logger.warn("Plugin file missing required exports, skipping", { path: absPath });
        await this.events.emit("plugin:error", {
          name: path.basename(absPath),
          error: "Missing required exports (name, description, schema, handler)",
        });
        return null;
      }

      // Deregister old version if it exists
      if (this.loadedPlugins.has(def.name)) {
        this.registry.deregister(def.name);
        logger.debug("Deregistered old version of plugin tool", { name: def.name });
      }

      // Wrap the plugin handler to inject AtelierContext
      const createContext = this.createContext;
      this.registry.register({
        name: def.name,
        description: def.description,
        schema: def.schema,
        handler: async (ctx) => {
          const atelier = createContext();
          return def.handler({ args: ctx.args }, atelier);
        },
      });

      this.loadedPlugins.set(def.name, absPath);

      await this.events.emit("plugin:loaded", { name: def.name, path: absPath });
      logger.info("Plugin tool loaded", { name: def.name, path: absPath });

      return def.name;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to load plugin file", { path: absPath, error: message });
      await this.events.emit("plugin:error", {
        name: path.basename(absPath),
        error: message,
      });
      return null;
    }
  }

  watch(dir: string): void {
    this.stopWatching();

    const absDir = path.resolve(dir);

    this.watcher = fs.watch(absDir, (eventType, filename) => {
      if (!filename || (!filename.endsWith(".ts") && !filename.endsWith(".js"))) {
        return;
      }

      // Debounce to avoid double-reloads
      const existing = this.debounceTimers.get(filename);
      if (existing) {
        clearTimeout(existing);
      }

      this.debounceTimers.set(
        filename,
        setTimeout(() => {
          this.debounceTimers.delete(filename);
          const filePath = path.join(absDir, filename);

          if (fs.existsSync(filePath)) {
            // File changed or created — reload
            this.loadFile(filePath).catch((err) => {
              logger.error("Hot reload failed", {
                file: filename,
                error: String(err),
              });
            });
          } else {
            // File removed — unload
            this.unloadByPath(filePath);
          }
        }, 100),
      );
    });

    logger.info("Watching plugin directory", { dir: absDir });
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  unloadAll(): void {
    for (const [name] of this.loadedPlugins) {
      this.registry.deregister(name);
      this.events.emit("plugin:unloaded", { name }).catch(() => {
        // Swallow event errors during bulk unload
      });
    }
    this.loadedPlugins.clear();
  }

  get loadedToolNames(): string[] {
    return [...this.loadedPlugins.keys()];
  }

  private unloadByPath(filePath: string): void {
    const absPath = path.resolve(filePath);
    for (const [name, loadedPath] of this.loadedPlugins) {
      if (loadedPath === absPath) {
        this.registry.deregister(name);
        this.loadedPlugins.delete(name);
        this.events.emit("plugin:unloaded", { name }).catch(() => {
          // Swallow event errors during unload
        });
        logger.info("Plugin tool unloaded", { name, path: absPath });
        return;
      }
    }
  }
}
