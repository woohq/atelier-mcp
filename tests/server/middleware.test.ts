import { describe, it, expect } from "vitest";
import {
  composeMiddleware,
  loggingMiddleware,
  timingMiddleware,
  createTimeoutMiddleware,
  createErrorHandlingMiddleware,
} from "../../src/server/middleware.js";
import type { ToolContext, ToolHandler, Middleware } from "../../src/server/middleware.js";
import { AtelierError, ErrorCode } from "../../src/types/errors.js";

describe("composeMiddleware", () => {
  it("executes middleware in order around handler", async () => {
    const order: string[] = [];
    const handler: ToolHandler = async () => {
      order.push("handler");
      return "result";
    };
    const mw1: Middleware = async (ctx, next) => {
      order.push("mw1-before");
      const result = await next();
      order.push("mw1-after");
      return result;
    };
    const mw2: Middleware = async (ctx, next) => {
      order.push("mw2-before");
      const result = await next();
      order.push("mw2-after");
      return result;
    };

    const composed = composeMiddleware(handler, [mw1, mw2]);
    await composed({ toolName: "test", args: {} });

    expect(order).toEqual(["mw1-before", "mw2-before", "handler", "mw2-after", "mw1-after"]);
  });
});

describe("loggingMiddleware", () => {
  it("assigns requestId to context", async () => {
    const ctx: ToolContext = { toolName: "test", args: {} };
    await loggingMiddleware(ctx, async () => "ok");
    expect(ctx.requestId).toBeDefined();
    expect(ctx.requestId!.length).toBe(8);
  });
});

describe("timingMiddleware", () => {
  it("passes through result", async () => {
    const result = await timingMiddleware({ toolName: "test", args: {} }, async () => "result");
    expect(result).toBe("result");
  });
});

describe("createTimeoutMiddleware", () => {
  it("passes through if handler completes in time", async () => {
    const mw = createTimeoutMiddleware(5000);
    const result = await mw({ toolName: "test", args: {} }, async () => "fast");
    expect(result).toBe("fast");
  });

  it("rejects if handler exceeds timeout", async () => {
    const mw = createTimeoutMiddleware(10);
    await expect(
      mw({ toolName: "slow", args: {} }, () => new Promise((r) => setTimeout(r, 200))),
    ).rejects.toBeInstanceOf(AtelierError);
  });
});

describe("createErrorHandlingMiddleware", () => {
  it("returns error response on handler throw", async () => {
    const mw = createErrorHandlingMiddleware();
    const result: any = await mw({ toolName: "test", args: {} }, async () => {
      throw new Error("boom");
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: "boom",
      tool: "test",
    });
  });

  it("includes error code for AtelierError", async () => {
    const mw = createErrorHandlingMiddleware();
    const result: any = await mw({ toolName: "test", args: {} }, async () => {
      throw new AtelierError(ErrorCode.OBJECT_NOT_FOUND, "not found");
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe(ErrorCode.OBJECT_NOT_FOUND);
  });
});
