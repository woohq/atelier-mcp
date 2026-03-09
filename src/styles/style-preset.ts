export interface PostProcessStep {
  type: "pixelate" | "cel_shade" | "dither" | "palette_quantize" | "outline";
  params: Record<string, unknown>;
}

export interface StylePreset {
  name: string;
  description: string;
  palette?: string;
  inlinePalette?: { name: string; colors: string[] };
  postProcess: PostProcessStep[];
  materialDefaults?: {
    flatShading?: boolean;
    roughness?: number;
    metalness?: number;
  };
  camera?: {
    preset?: string;
    position?: [number, number, number];
    lookAt?: [number, number, number];
    fov?: number;
  };
  renderSize?: { width: number; height: number };
}

export function defineStyle(preset: StylePreset): StylePreset {
  return preset;
}
