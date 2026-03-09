import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventBus } from "../../src/server/event-bus.js";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it("calls listeners on emit", async () => {
    const fn = vi.fn();
    bus.on("server:started", fn);
    await bus.emit("server:started", { timestamp: 123 });
    expect(fn).toHaveBeenCalledWith({ timestamp: 123 });
  });

  it("supports multiple listeners", async () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on("server:started", fn1);
    bus.on("server:started", fn2);
    await bus.emit("server:started", { timestamp: 123 });
    expect(fn1).toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });

  it("returns unsubscribe function", async () => {
    const fn = vi.fn();
    const unsub = bus.on("server:started", fn);
    unsub();
    await bus.emit("server:started", { timestamp: 123 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("isolates listener errors", async () => {
    const fn1 = vi.fn(() => {
      throw new Error("boom");
    });
    const fn2 = vi.fn();
    bus.on("server:started", fn1);
    bus.on("server:started", fn2);
    const errors = await bus.emit("server:started", { timestamp: 123 });
    expect(errors).toHaveLength(1);
    expect(fn2).toHaveBeenCalled();
  });

  it("emitStrict throws on listener error", async () => {
    bus.on("server:started", () => {
      throw new Error("fail");
    });
    await expect(bus.emitStrict("server:started", { timestamp: 123 })).rejects.toThrow("fail");
  });

  it("emitStrict throws AggregateError for multiple failures", async () => {
    bus.on("server:started", () => {
      throw new Error("fail1");
    });
    bus.on("server:started", () => {
      throw new Error("fail2");
    });
    await expect(bus.emitStrict("server:started", { timestamp: 123 })).rejects.toBeInstanceOf(
      AggregateError,
    );
  });

  it("removeAllListeners clears all", async () => {
    const fn = vi.fn();
    bus.on("server:started", fn);
    bus.removeAllListeners();
    await bus.emit("server:started", { timestamp: 123 });
    expect(fn).not.toHaveBeenCalled();
  });

  it("removeAllListeners clears specific event", async () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on("server:started", fn1);
    bus.on("server:stopped", fn2);
    bus.removeAllListeners("server:started");
    await bus.emit("server:started", { timestamp: 123 });
    await bus.emit("server:stopped", { timestamp: 123 });
    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalled();
  });
});
