import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { z } from "zod";

describe("ToolRegistry", () => {
  it("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "test_tool",
      description: "A test tool",
      schema: { input: z.string() },
      handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    });

    expect(registry.has("test_tool")).toBe(true);
    expect(registry.get("test_tool")?.name).toBe("test_tool");
    expect(registry.allNames()).toEqual(["test_tool"]);
  });

  it("deregisters tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "tool1",
      description: "d",
      schema: {},
      handler: async () => ({ content: [] }),
    });

    expect(registry.deregister("tool1")).toBe(true);
    expect(registry.has("tool1")).toBe(false);
    expect(registry.deregister("nonexistent")).toBe(false);
  });

  it("overwrites on duplicate registration", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "dup",
      description: "first",
      schema: {},
      handler: async () => ({ content: [] }),
    });
    registry.register({
      name: "dup",
      description: "second",
      schema: {},
      handler: async () => ({ content: [] }),
    });

    expect(registry.get("dup")?.description).toBe("second");
  });

  it("clears all tools", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "a",
      description: "d",
      schema: {},
      handler: async () => ({ content: [] }),
    });
    registry.register({
      name: "b",
      description: "d",
      schema: {},
      handler: async () => ({ content: [] }),
    });
    registry.clear();
    expect(registry.allNames()).toEqual([]);
  });
});
