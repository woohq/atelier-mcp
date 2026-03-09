/**
 * Server-side palette registry. Pure TS, no browser dependency.
 * Stores named color palettes and resolves colors by index.
 */

export interface Palette {
  name: string;
  colors: string[]; // hex color strings
}

export class PaletteRegistry {
  private palettes = new Map<string, Palette>();
  private activePalette: string | null = null;

  register(palette: Palette): void {
    this.palettes.set(palette.name, palette);
  }

  get(name: string): Palette | undefined {
    return this.palettes.get(name);
  }

  getActive(): Palette | undefined {
    if (this.activePalette === null) return undefined;
    return this.palettes.get(this.activePalette);
  }

  setActive(name: string): void {
    if (!this.palettes.has(name)) {
      throw new Error(`Palette "${name}" not found`);
    }
    this.activePalette = name;
  }

  resolveColor(paletteIndex: number, paletteName?: string): string {
    const name = paletteName ?? this.activePalette;
    if (name === null || name === undefined) {
      throw new Error("No palette specified and no active palette set");
    }

    const palette = this.palettes.get(name);
    if (!palette) {
      throw new Error(`Palette "${name}" not found`);
    }

    if (paletteIndex < 0 || paletteIndex >= palette.colors.length) {
      throw new Error(
        `Palette index ${paletteIndex} out of bounds for palette "${name}" (0-${palette.colors.length - 1})`,
      );
    }

    return palette.colors[paletteIndex];
  }

  list(): string[] {
    return [...this.palettes.keys()];
  }

  clear(): void {
    this.palettes.clear();
    this.activePalette = null;
  }
}
