import { describe, it, expect, beforeEach } from "vitest";
import { SceneEngine } from "../../src/engine/scene-engine.js";

describe("SceneEngine", () => {
  let engine: SceneEngine;

  beforeEach(() => {
    engine = new SceneEngine();
  });

  it("creates objects with generated IDs", () => {
    const obj = engine.create({ name: "box1", type: "box" });
    expect(obj.id).toBe("box_1");
    expect(obj.name).toBe("box1");
    expect(obj.type).toBe("box");
    expect(obj.parentId).toBeNull();
  });

  it("creates objects with custom IDs", () => {
    const obj = engine.create({ id: "my-box", name: "box1", type: "box" });
    expect(obj.id).toBe("my-box");
  });

  it("rejects duplicate IDs", () => {
    engine.create({ id: "dup", name: "a", type: "box" });
    expect(() => engine.create({ id: "dup", name: "b", type: "box" })).toThrow(
      'Object with id "dup" already exists',
    );
  });

  it("gets objects by ID", () => {
    engine.create({ id: "test", name: "test", type: "box" });
    expect(engine.get("test")).toBeDefined();
    expect(engine.get("nonexistent")).toBeUndefined();
  });

  it("removes objects and their children", () => {
    engine.create({ id: "parent", name: "parent", type: "group" });
    engine.create({ id: "child1", name: "child1", type: "box", parentId: "parent" });
    engine.create({ id: "child2", name: "child2", type: "box", parentId: "parent" });

    engine.remove("parent");
    expect(engine.get("parent")).toBeUndefined();
    expect(engine.get("child1")).toBeUndefined();
    expect(engine.get("child2")).toBeUndefined();
  });

  it("lists all objects", () => {
    engine.create({ name: "a", type: "box" });
    engine.create({ name: "b", type: "sphere" });
    expect(engine.list()).toHaveLength(2);
  });

  it("gets children of a parent", () => {
    engine.create({ id: "p", name: "parent", type: "group" });
    engine.create({ id: "c1", name: "c1", type: "box", parentId: "p" });
    engine.create({ id: "c2", name: "c2", type: "box", parentId: "p" });
    engine.create({ id: "other", name: "other", type: "box" });

    const children = engine.getChildren("p");
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("clears all objects and resets ID counter", () => {
    engine.create({ name: "a", type: "box" });
    engine.create({ name: "b", type: "box" });
    engine.clear();
    expect(engine.count()).toBe(0);

    // ID counter should reset
    const obj = engine.create({ name: "c", type: "box" });
    expect(obj.id).toBe("box_1");
  });

  it("stores metadata", () => {
    const obj = engine.create({
      name: "meta",
      type: "box",
      metadata: { width: 2, height: 3 },
    });
    expect(obj.metadata).toEqual({ width: 2, height: 3 });
  });
});
