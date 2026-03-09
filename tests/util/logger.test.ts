import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, setLogLevel } from "../../src/util/logger.js";

describe("logger", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setLogLevel("debug");
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    setLogLevel("info");
  });

  it("logs at debug level when enabled", () => {
    logger.debug("test message", { key: "value" });
    expect(consoleSpy).toHaveBeenCalled();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.level).toBe("debug");
    expect(logged.message).toBe("test message");
    expect(logged.key).toBe("value");
  });

  it("filters below current level", () => {
    setLogLevel("warn");
    logger.debug("hidden");
    logger.info("hidden");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("logs at error level", () => {
    logger.error("bad thing", { code: 500 });
    expect(consoleSpy).toHaveBeenCalled();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(logged.level).toBe("error");
  });
});
