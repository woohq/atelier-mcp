/**
 * Session save/load — serialize scene state to JSON.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { SceneEngine, SceneObject } from "./scene-engine.js";
import type { PaletteRegistry, Palette } from "./palette-registry.js";
import type { ShaderRegistry, PostProcessEffect, CustomShader } from "./shader-registry.js";
import { logger } from "../util/logger.js";

export interface SessionData {
  version: 1;
  timestamp: number;
  objects: SceneObject[];
  palettes: Palette[];
  activePalette: string | null;
  effects: PostProcessEffect[];
  customShaders: CustomShader[];
  activeStyle?: string;
}

export function captureSession(
  scene: SceneEngine,
  palettes: PaletteRegistry,
  shaders: ShaderRegistry,
): SessionData {
  return {
    version: 1,
    timestamp: Date.now(),
    objects: scene.list(),
    palettes: palettes.list().map((name) => palettes.get(name)!),
    activePalette: palettes.getActive()?.name ?? null,
    effects: shaders.getEffectChain(),
    customShaders: shaders.listCustomShaders(),
  };
}

export function restoreSession(
  data: SessionData,
  scene: SceneEngine,
  palettes: PaletteRegistry,
  shaders: ShaderRegistry,
): void {
  // Clear existing state
  scene.clear();
  shaders.clear();

  // Restore objects
  for (const obj of data.objects) {
    scene.create({
      id: obj.id,
      name: obj.name,
      type: obj.type,
      parentId: obj.parentId,
      metadata: obj.metadata,
    });
  }

  // Restore palettes
  for (const palette of data.palettes) {
    palettes.register(palette);
  }
  if (data.activePalette) {
    palettes.setActive(data.activePalette);
  }

  // Restore effects
  for (const effect of data.effects) {
    shaders.addEffect(effect);
  }

  // Restore custom shaders
  for (const shader of data.customShaders) {
    shaders.registerShader(shader);
  }
}

export async function saveSessionToFile(
  path: string,
  scene: SceneEngine,
  palettes: PaletteRegistry,
  shaders: ShaderRegistry,
): Promise<void> {
  const data = captureSession(scene, palettes, shaders);
  await writeFile(path, JSON.stringify(data, null, 2));
  logger.info("Session saved", { path });
}

export async function loadSessionFromFile(
  path: string,
  scene: SceneEngine,
  palettes: PaletteRegistry,
  shaders: ShaderRegistry,
): Promise<SessionData> {
  const raw = await readFile(path, "utf-8");
  const data: SessionData = JSON.parse(raw);
  if (data.version !== 1) {
    throw new Error(`Unsupported session version: ${data.version}`);
  }
  restoreSession(data, scene, palettes, shaders);
  logger.info("Session loaded", { path, objects: data.objects.length });
  return data;
}
