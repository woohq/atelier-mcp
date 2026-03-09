import { describe, it, expect, beforeEach } from "vitest";
import { AnimationClipRegistry } from "../../src/animation/animation-clip.js";

describe("AnimationClipRegistry", () => {
  let registry: AnimationClipRegistry;

  beforeEach(() => {
    registry = new AnimationClipRegistry();
  });

  describe("create", () => {
    it("creates a clip with auto-generated id", () => {
      const clip = registry.create({ name: "walk", duration: 2.0 });
      expect(clip.id).toMatch(/^clip_\d+$/);
      expect(clip.name).toBe("walk");
      expect(clip.duration).toBe(2.0);
      expect(clip.loop).toBe(false);
      expect(clip.keyframes).toEqual([]);
    });

    it("creates a clip with custom id and loop", () => {
      const clip = registry.create({ id: "my-clip", name: "run", duration: 1.0, loop: true });
      expect(clip.id).toBe("my-clip");
      expect(clip.loop).toBe(true);
    });

    it("throws on duplicate id", () => {
      registry.create({ id: "dup", name: "a", duration: 1 });
      expect(() => registry.create({ id: "dup", name: "b", duration: 1 })).toThrow(
        'Animation clip with id "dup" already exists',
      );
    });
  });

  describe("get", () => {
    it("returns the clip by id", () => {
      const clip = registry.create({ name: "test", duration: 1 });
      expect(registry.get(clip.id)).toBe(clip);
    });

    it("returns undefined for unknown id", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("addKeyframe", () => {
    it("adds a keyframe", () => {
      const clip = registry.create({ name: "test", duration: 2 });
      registry.addKeyframe(clip.id, {
        time: 0.5,
        boneId: "bone_1",
        position: [1, 2, 3],
        easing: "ease-in",
      });

      expect(clip.keyframes).toHaveLength(1);
      expect(clip.keyframes[0].time).toBe(0.5);
      expect(clip.keyframes[0].boneId).toBe("bone_1");
      expect(clip.keyframes[0].position).toEqual([1, 2, 3]);
      expect(clip.keyframes[0].easing).toBe("ease-in");
    });

    it("sorts keyframes by time", () => {
      const clip = registry.create({ name: "test", duration: 3 });
      registry.addKeyframe(clip.id, { time: 2, boneId: "b1" });
      registry.addKeyframe(clip.id, { time: 0.5, boneId: "b2" });
      registry.addKeyframe(clip.id, { time: 1, boneId: "b3" });

      expect(clip.keyframes.map((kf) => kf.time)).toEqual([0.5, 1, 2]);
    });

    it("throws for unknown clip", () => {
      expect(() => registry.addKeyframe("nope", { time: 0, boneId: "b" })).toThrow(
        'Animation clip "nope" not found',
      );
    });

    it("throws for time out of range (negative)", () => {
      const clip = registry.create({ name: "test", duration: 2 });
      expect(() => registry.addKeyframe(clip.id, { time: -1, boneId: "b" })).toThrow(
        "Keyframe time -1 is out of range [0, 2]",
      );
    });

    it("throws for time exceeding duration", () => {
      const clip = registry.create({ name: "test", duration: 2 });
      expect(() => registry.addKeyframe(clip.id, { time: 3, boneId: "b" })).toThrow(
        "Keyframe time 3 is out of range [0, 2]",
      );
    });

    it("allows keyframe at time 0 and at duration", () => {
      const clip = registry.create({ name: "test", duration: 2 });
      registry.addKeyframe(clip.id, { time: 0, boneId: "b" });
      registry.addKeyframe(clip.id, { time: 2, boneId: "b" });
      expect(clip.keyframes).toHaveLength(2);
    });

    it("stores rotation, scale, and easing", () => {
      const clip = registry.create({ name: "test", duration: 1 });
      registry.addKeyframe(clip.id, {
        time: 0,
        boneId: "b",
        rotation: [0, Math.PI, 0],
        scale: [2, 2, 2],
        easing: "ease-in-out",
      });

      const kf = clip.keyframes[0];
      expect(kf.rotation).toEqual([0, Math.PI, 0]);
      expect(kf.scale).toEqual([2, 2, 2]);
      expect(kf.easing).toBe("ease-in-out");
    });
  });

  describe("list", () => {
    it("returns all clips", () => {
      registry.create({ name: "walk", duration: 2 });
      registry.create({ name: "run", duration: 1 });
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.name)).toEqual(["walk", "run"]);
    });

    it("returns empty array when none exist", () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe("clear", () => {
    it("removes all clips", () => {
      registry.create({ name: "a", duration: 1 });
      registry.create({ name: "b", duration: 2 });
      registry.clear();
      expect(registry.list()).toEqual([]);
    });
  });
});
