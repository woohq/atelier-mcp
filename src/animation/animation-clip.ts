/**
 * Server-side animation clip registry. Pure TS, no Three.js dependency.
 * Tracks keyframe-based animation clips by ID.
 */

export interface Keyframe {
  time: number;
  boneId: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface AnimationClip {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  keyframes: Keyframe[];
}

export class AnimationClipRegistry {
  private clips = new Map<string, AnimationClip>();
  private nextId = 1;

  private generateId(prefix = "clip"): string {
    return `${prefix}_${this.nextId++}`;
  }

  create(params: { id?: string; name: string; duration: number; loop?: boolean }): AnimationClip {
    const id = params.id ?? this.generateId();
    if (this.clips.has(id)) {
      throw new Error(`Animation clip with id "${id}" already exists`);
    }
    const clip: AnimationClip = {
      id,
      name: params.name,
      duration: params.duration,
      loop: params.loop ?? false,
      keyframes: [],
    };
    this.clips.set(id, clip);
    return clip;
  }

  addKeyframe(clipId: string, keyframe: Keyframe): void {
    const clip = this.clips.get(clipId);
    if (!clip) {
      throw new Error(`Animation clip "${clipId}" not found`);
    }
    if (keyframe.time < 0 || keyframe.time > clip.duration) {
      throw new Error(`Keyframe time ${keyframe.time} is out of range [0, ${clip.duration}]`);
    }
    clip.keyframes.push({ ...keyframe });
    // Keep keyframes sorted by time for predictable iteration
    clip.keyframes.sort((a, b) => a.time - b.time);
  }

  get(id: string): AnimationClip | undefined {
    return this.clips.get(id);
  }

  list(): AnimationClip[] {
    return [...this.clips.values()];
  }

  clear(): void {
    this.clips.clear();
    this.nextId = 1;
  }
}
