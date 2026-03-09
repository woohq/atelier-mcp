/**
 * Playwright bridge to the Three.js preview page.
 * Lazy-launches headless Chromium on first tool call.
 * Auto-starts the Vite preview server if it isn't already running.
 * Communicates via page.evaluate() RPC through window.__atelier__.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { logger } from "../util/logger.js";
import { AtelierError, ErrorCode } from "../types/errors.js";

export interface BridgeCommand {
  command: string;
  params: Record<string, unknown>;
}

export interface BridgeResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export class BrowserBridge {
  private page: unknown = null; // Playwright Page — typed loosely to avoid hard dep at import time
  private browser: unknown = null;
  private viteProcess: ChildProcess | null = null;
  private previewUrl: string;
  private launching = false;
  private launchPromise: Promise<void> | null = null;

  constructor(previewUrl = "http://localhost:5173") {
    this.previewUrl = previewUrl;
  }

  get isConnected(): boolean {
    return this.page !== null;
  }

  async ensureConnected(): Promise<void> {
    if (this.page) return;
    if (this.launchPromise) {
      await this.launchPromise;
      return;
    }
    this.launchPromise = this.launch();
    try {
      await this.launchPromise;
    } finally {
      this.launchPromise = null;
    }
  }

  /** Check if the Vite preview server is reachable. */
  private async isPreviewRunning(): Promise<boolean> {
    try {
      const res = await fetch(this.previewUrl, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Start the Vite dev server as a child process. */
  private async startVite(): Promise<void> {
    // Resolve project root from this file: src/bridge/browser-bridge.ts → project root
    const thisFile = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(thisFile), "..", "..");

    logger.info("Starting Vite preview server...", { cwd: projectRoot });

    this.viteProcess = spawn("npx", ["vite", "preview/"], {
      cwd: projectRoot,
      stdio: "pipe",
      detached: false,
    });

    this.viteProcess.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) logger.debug("[vite]", { msg });
    });

    this.viteProcess.on("exit", (code) => {
      logger.warn("Vite process exited", { code });
      this.viteProcess = null;
    });

    // Wait for Vite to be ready (poll until reachable or timeout)
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await this.isPreviewRunning()) {
        logger.info("Vite preview server is ready");
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new AtelierError(
      ErrorCode.BRIDGE_LAUNCH_FAILED,
      "Vite preview server did not start within 15 seconds",
    );
  }

  private async launch(): Promise<void> {
    if (this.launching) return;
    this.launching = true;
    try {
      // Auto-start Vite if not already running
      if (!(await this.isPreviewRunning())) {
        await this.startVite();
      }

      logger.info("Launching headless browser...");
      // Dynamic import to avoid requiring playwright at load time
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({
        args: [
          "--no-sandbox",
          "--enable-webgl",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--ignore-gpu-blocklist",
        ],
      });
      const context = await (this.browser as any).newContext({
        viewport: { width: 1024, height: 1024 },
      });
      this.page = await context.newPage();

      // Navigate to preview page with headless flag so the preview can distinguish modes
      const headlessUrl = new URL(this.previewUrl);
      headlessUrl.searchParams.set("mode", "headless");
      await (this.page as any).goto(headlessUrl.toString(), { waitUntil: "networkidle" });

      // Wait for the RPC interface to be defined (JS modules may execute after networkidle)
      await (this.page as any).waitForFunction(
        () => typeof (window as any).__atelier__ !== "undefined",
        { timeout: 10000 },
      );

      logger.info("Browser bridge connected");

      // Auto-relaunch on crash
      (this.page as any).on("crash", () => {
        logger.error("Preview page crashed, will relaunch on next call");
        this.page = null;
      });
    } catch (err) {
      this.page = null;
      this.browser = null;
      this.launching = false;
      if (err instanceof AtelierError) throw err;
      throw new AtelierError(
        ErrorCode.BRIDGE_LAUNCH_FAILED,
        `Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.launching = false;
    }
  }

  async execute(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureConnected();
    if (!this.page) {
      throw new AtelierError(ErrorCode.BRIDGE_NOT_CONNECTED, "Browser bridge not connected");
    }

    try {
      const result: BridgeResult = await (this.page as any).evaluate(
        ([cmd, p]: [string, Record<string, unknown>]) => {
          return (window as any).__atelier__.execute(cmd, p);
        },
        [command, params],
      );

      if (!result.ok) {
        throw new AtelierError(
          ErrorCode.RENDER_FAILED,
          result.error ?? `Bridge command "${command}" failed`,
        );
      }

      return result.data;
    } catch (err) {
      if (err instanceof AtelierError) throw err;
      // Page may have crashed
      if (String(err).includes("Target closed") || String(err).includes("crashed")) {
        this.page = null;
        throw new AtelierError(ErrorCode.BRIDGE_CRASHED, "Preview page crashed during command");
      }
      throw new AtelierError(
        ErrorCode.RENDER_FAILED,
        `Bridge command "${command}" error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async getScreenshot(): Promise<string> {
    await this.ensureConnected();
    if (!this.page) {
      throw new AtelierError(ErrorCode.BRIDGE_NOT_CONNECTED, "Browser bridge not connected");
    }

    const buffer = await (this.page as any).screenshot({ type: "png" });
    return (buffer as Buffer).toString("base64");
  }

  async shutdown(): Promise<void> {
    if (this.browser) {
      try {
        await (this.browser as any).close();
      } catch {
        // Ignore close errors
      }
      this.browser = null;
      this.page = null;
    }
    if (this.viteProcess) {
      this.viteProcess.kill();
      this.viteProcess = null;
    }
    logger.info("Browser bridge shut down");
  }
}
