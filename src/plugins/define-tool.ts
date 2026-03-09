import type { ZodRawShape } from "zod";
import type { SeededRNG } from "../util/rng.js";
import type { StylePreset } from "../styles/style-preset.js";

export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
}

export interface AtelierContext {
  // Existing
  invoke(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  palette(index: number, paletteName?: string): string;
  getObject(id: string): unknown | undefined;
  listObjects(): unknown[];

  // New
  clone(objectId: string): Promise<string>;
  group(name: string, fn: (groupId: string) => Promise<void>): Promise<string>;
  measure(objectId: string): Promise<BoundingBox>;
  render(options?: { width?: number; height?: number }): Promise<string>;
  random(seed?: number): SeededRNG;
  activeStyle(): StylePreset | undefined;
}

export interface PluginToolDefinition<T extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: T;
  handler: (ctx: { args: Record<string, unknown> }, atelier: AtelierContext) => Promise<unknown>;
}

export function defineTool<T extends ZodRawShape>(
  def: PluginToolDefinition<T>,
): PluginToolDefinition<T> {
  return def;
}
