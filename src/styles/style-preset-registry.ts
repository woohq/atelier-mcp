import type { StylePreset } from "./style-preset.js";

export class StylePresetRegistry {
  private presets = new Map<string, StylePreset>();
  private activePreset: string | null = null;

  register(preset: StylePreset): void {
    this.presets.set(preset.name, preset);
  }

  get(name: string): StylePreset | undefined {
    return this.presets.get(name);
  }

  getActive(): StylePreset | undefined {
    if (this.activePreset === null) return undefined;
    return this.presets.get(this.activePreset);
  }

  setActive(name: string): void {
    if (!this.presets.has(name)) {
      throw new Error(`Style preset "${name}" not found`);
    }
    this.activePreset = name;
  }

  clearActive(): void {
    this.activePreset = null;
  }

  list(): StylePreset[] {
    return [...this.presets.values()];
  }

  listNames(): string[] {
    return [...this.presets.keys()];
  }

  clear(): void {
    this.presets.clear();
    this.activePreset = null;
  }
}
