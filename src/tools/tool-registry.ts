import type { ZodRawShape, z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext, ToolHandler } from "../server/middleware.js";
import { logger } from "../util/logger.js";

export interface ToolDefinition<T extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: T;
  handler: (ctx: ToolContext<z.infer<z.ZodObject<T>>>) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      logger.warn("Duplicate tool registration, overwriting", {
        name: definition.name,
      });
    }
    this.tools.set(definition.name, definition);
  }

  deregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  allNames(): string[] {
    return [...this.tools.keys()];
  }

  wireToMcp(mcp: McpServer, wrapHandler: (handler: ToolHandler) => ToolHandler): void {
    for (const [_name, def] of this.tools) {
      const wrapped = wrapHandler(def.handler as ToolHandler);
      mcp.registerTool(
        def.name,
        {
          description: def.description,
          inputSchema: def.schema,
        },
        async (args: { [x: string]: unknown }) => {
          const result = await wrapped({ toolName: def.name, args });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return result as any;
        },
      );
    }
  }

  clear(): void {
    this.tools.clear();
  }
}
