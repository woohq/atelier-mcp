import { describe, it, expect } from "vitest";
import { defineTool } from "../../src/plugins/define-tool.js";
import { z } from "zod";

describe("defineTool", () => {
  it("returns the definition unchanged", () => {
    const def = {
      name: "my_tool",
      description: "A tool",
      schema: { input: z.string() },
      handler: async (ctx: { args: Record<string, unknown> }) => {
        return { result: ctx.args.input };
      },
    };

    const result = defineTool(def);
    expect(result).toBe(def);
    expect(result.name).toBe("my_tool");
    expect(result.description).toBe("A tool");
    expect(result.schema).toBe(def.schema);
    expect(result.handler).toBe(def.handler);
  });

  it("preserves the schema types", () => {
    const def = defineTool({
      name: "typed_tool",
      description: "Typed",
      schema: {
        count: z.number().int().min(0),
        label: z.string().optional(),
      },
      handler: async () => ({ ok: true }),
    });

    expect(def.schema.count).toBeDefined();
    expect(def.schema.label).toBeDefined();
  });
});
