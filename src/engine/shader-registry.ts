/**
 * Server-side shader & post-processing registry. Pure TS, no Three.js dependency.
 * Tracks the post-process effect chain and custom shader registrations.
 */

export interface PostProcessEffect {
  id: string;
  type:
    | "pixelate"
    | "cel_shade"
    | "dither"
    | "palette_quantize"
    | "outline"
    | "bloom"
    | "vignette"
    | "chromatic_aberration"
    | "film_grain"
    | "halftone"
    | "color_grade"
    | "sharpen"
    | "invert"
    | "edge_glow"
    | "crosshatch"
    | "watercolor"
    | "custom";
  params: Record<string, unknown>;
  order: number;
}

export interface CustomShader {
  id: string;
  name: string;
  fragmentShader: string;
  vertexShader: string;
  uniforms: Record<string, { type: string; value: unknown }>;
}

export class ShaderRegistry {
  private effects = new Map<string, PostProcessEffect>();
  private customShaders = new Map<string, CustomShader>();
  private nextOrder = 0;

  addEffect(effect: Omit<PostProcessEffect, "id" | "order"> & { id?: string }): PostProcessEffect {
    const id = effect.id ?? `fx_${effect.type}_${this.nextOrder}`;
    const entry: PostProcessEffect = {
      id,
      type: effect.type,
      params: { ...effect.params },
      order: this.nextOrder++,
    };
    this.effects.set(id, entry);
    return entry;
  }

  removeEffect(id: string): boolean {
    return this.effects.delete(id);
  }

  getEffect(id: string): PostProcessEffect | undefined {
    return this.effects.get(id);
  }

  clearEffects(): void {
    this.effects.clear();
    this.nextOrder = 0;
  }

  getEffectChain(): PostProcessEffect[] {
    return [...this.effects.values()].sort((a, b) => a.order - b.order);
  }

  effectCount(): number {
    return this.effects.size;
  }

  registerShader(shader: CustomShader): void {
    this.customShaders.set(shader.id, shader);
  }

  getShader(id: string): CustomShader | undefined {
    return this.customShaders.get(id);
  }

  updateUniform(shaderId: string, uniformName: string, value: unknown): void {
    const shader = this.customShaders.get(shaderId);
    if (!shader) {
      throw new Error(`Shader "${shaderId}" not found`);
    }
    if (!shader.uniforms[uniformName]) {
      throw new Error(`Uniform "${uniformName}" not found on shader "${shaderId}"`);
    }
    shader.uniforms[uniformName] = { ...shader.uniforms[uniformName], value };
  }

  listCustomShaders(): CustomShader[] {
    return [...this.customShaders.values()];
  }

  removeShader(id: string): boolean {
    return this.customShaders.delete(id);
  }

  clear(): void {
    this.effects.clear();
    this.customShaders.clear();
    this.nextOrder = 0;
  }
}
