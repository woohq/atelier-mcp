import { describe, it, expect, beforeEach } from "vitest";
import { CommandHistory } from "../../src/engine/command-history.js";

describe("CommandHistory", () => {
  let history: CommandHistory;

  beforeEach(() => {
    history = new CommandHistory();
  });

  it("starts empty", () => {
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undoCount).toBe(0);
    expect(history.redoCount).toBe(0);
  });

  it("pushes records to undo stack", () => {
    history.push({
      toolName: "create_primitive",
      args: { shape: "box" },
      undoData: { id: "box_1" },
      timestamp: Date.now(),
    });
    expect(history.canUndo()).toBe(true);
    expect(history.undoCount).toBe(1);
  });

  it("popUndo moves record to redo stack", () => {
    history.push({
      toolName: "create_primitive",
      args: { shape: "box" },
      undoData: { id: "box_1" },
      timestamp: Date.now(),
    });

    const record = history.popUndo();
    expect(record).toBeDefined();
    expect(record!.toolName).toBe("create_primitive");
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
  });

  it("popRedo moves record back to undo stack", () => {
    history.push({
      toolName: "test",
      args: {},
      undoData: {},
      timestamp: Date.now(),
    });

    history.popUndo();
    const record = history.popRedo();
    expect(record).toBeDefined();
    expect(history.canUndo()).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it("clears redo stack on new push", () => {
    history.push({ toolName: "a", args: {}, undoData: {}, timestamp: 1 });
    history.popUndo(); // a is now in redo

    history.push({ toolName: "b", args: {}, undoData: {}, timestamp: 2 });
    expect(history.canRedo()).toBe(false);
  });

  it("returns undefined when popping empty stacks", () => {
    expect(history.popUndo()).toBeUndefined();
    expect(history.popRedo()).toBeUndefined();
  });

  it("respects max size", () => {
    const small = new CommandHistory(3);
    for (let i = 0; i < 5; i++) {
      small.push({ toolName: `t${i}`, args: {}, undoData: {}, timestamp: i });
    }
    expect(small.undoCount).toBe(3);
    // Oldest entries should be dropped
    const first = small.popUndo();
    expect(first!.toolName).toBe("t4");
  });

  it("clears all stacks", () => {
    history.push({ toolName: "a", args: {}, undoData: {}, timestamp: 1 });
    history.push({ toolName: "b", args: {}, undoData: {}, timestamp: 2 });
    history.popUndo();
    history.clear();
    expect(history.undoCount).toBe(0);
    expect(history.redoCount).toBe(0);
  });
});
