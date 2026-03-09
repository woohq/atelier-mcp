import { randomUUID } from "node:crypto";
import { logger } from "../util/logger.js";
import { AtelierError, ErrorCode } from "../types/errors.js";

export interface ToolContext<TArgs = Record<string, unknown>> {
  toolName: string;
  args: TArgs;
  requestId?: string;
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type ToolHandler = (ctx: ToolContext) => Promise<unknown>;

export type Middleware = (ctx: ToolContext, next: () => Promise<unknown>) => Promise<unknown>;

/**
 * Composes a chain of middleware around a base handler.
 * Middleware execute in order: first middleware wraps second, which wraps third, etc.
 */
export function composeMiddleware(handler: ToolHandler, middlewares: Middleware[]): ToolHandler {
  let composed = handler;
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i];
    const next = composed;
    composed = (ctx: ToolContext) => mw(ctx, () => next(ctx));
  }
  return composed;
}

// --- Built-in middleware ---

export const loggingMiddleware: Middleware = async (ctx, next) => {
  const requestId = randomUUID().slice(0, 8);
  ctx.requestId = requestId;
  logger.debug("Tool call start", { tool: ctx.toolName, requestId });
  try {
    const result = await next();
    logger.debug("Tool call success", { tool: ctx.toolName, requestId });
    return result;
  } catch (err) {
    logger.error("Tool call error", {
      tool: ctx.toolName,
      requestId,
      error: String(err),
    });
    throw err;
  }
};

export const timingMiddleware: Middleware = async (ctx, next) => {
  const start = performance.now();
  try {
    return await next();
  } finally {
    const elapsed = performance.now() - start;
    logger.debug("Tool call timing", {
      tool: ctx.toolName,
      requestId: ctx.requestId,
      durationMs: Math.round(elapsed * 100) / 100,
    });
  }
};

const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export function createTimeoutMiddleware(timeoutMs = DEFAULT_TOOL_TIMEOUT_MS): Middleware {
  return async (ctx, next) => {
    const controller = new AbortController();
    ctx.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await Promise.race([
        next(),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(
              new AtelierError(
                ErrorCode.TOOL_TIMEOUT,
                `Tool "${ctx.toolName}" timed out after ${timeoutMs}ms`,
              ),
            );
          });
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createErrorHandlingMiddleware(): Middleware {
  return async (ctx, next) => {
    try {
      return await next();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const payload: Record<string, unknown> = {
        error: message,
        tool: ctx.toolName,
      };
      if (err instanceof AtelierError) {
        payload.code = err.code;
      }
      if (err instanceof Error && err.stack) {
        logger.debug("Tool error stack trace", {
          tool: ctx.toolName,
          stack: err.stack,
        });
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(payload),
          },
        ],
        isError: true,
      };
    }
  };
}
