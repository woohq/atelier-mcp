import { describe, it, expect, beforeEach } from "vitest";
import { SkeletonRegistry } from "../../src/animation/skeleton.js";

describe("SkeletonRegistry", () => {
  let registry: SkeletonRegistry;

  beforeEach(() => {
    registry = new SkeletonRegistry();
  });

  describe("create", () => {
    it("creates a skeleton with auto-generated id", () => {
      const skel = registry.create({ name: "humanoid" });
      expect(skel.id).toMatch(/^skel_\d+$/);
      expect(skel.name).toBe("humanoid");
      expect(skel.bones.size).toBe(0);
      expect(skel.rootBoneId).toBeNull();
    });

    it("creates a skeleton with a custom id", () => {
      const skel = registry.create({ id: "custom-skel", name: "robot" });
      expect(skel.id).toBe("custom-skel");
      expect(skel.name).toBe("robot");
    });

    it("throws on duplicate id", () => {
      registry.create({ id: "dup", name: "first" });
      expect(() => registry.create({ id: "dup", name: "second" })).toThrow(
        'Skeleton with id "dup" already exists',
      );
    });
  });

  describe("get", () => {
    it("returns the skeleton by id", () => {
      const skel = registry.create({ name: "test" });
      expect(registry.get(skel.id)).toBe(skel);
    });

    it("returns undefined for unknown id", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("addBone", () => {
    it("adds a root bone", () => {
      const skel = registry.create({ name: "test" });
      const bone = registry.addBone(skel.id, {
        name: "spine",
        parentId: null,
        length: 1.5,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      });

      expect(bone.id).toMatch(/^bone_\d+$/);
      expect(bone.name).toBe("spine");
      expect(bone.parentId).toBeNull();
      expect(bone.length).toBe(1.5);
      expect(skel.bones.size).toBe(1);
      expect(skel.rootBoneId).toBe(bone.id);
    });

    it("adds a child bone", () => {
      const skel = registry.create({ name: "test" });
      const root = registry.addBone(skel.id, {
        name: "root",
        parentId: null,
        length: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      });
      const child = registry.addBone(skel.id, {
        name: "arm",
        parentId: root.id,
        length: 0.8,
        position: [0.5, 1, 0],
        rotation: [0, 0, Math.PI / 4],
      });

      expect(child.parentId).toBe(root.id);
      expect(skel.bones.size).toBe(2);
    });

    it("throws for unknown skeleton", () => {
      expect(() =>
        registry.addBone("nope", {
          name: "bone",
          parentId: null,
          length: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        }),
      ).toThrow('Skeleton "nope" not found');
    });

    it("throws for unknown parent bone", () => {
      const skel = registry.create({ name: "test" });
      expect(() =>
        registry.addBone(skel.id, {
          name: "orphan",
          parentId: "nonexistent",
          length: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        }),
      ).toThrow('Parent bone "nonexistent" not found');
    });

    it("only the first root bone becomes rootBoneId", () => {
      const skel = registry.create({ name: "test" });
      const first = registry.addBone(skel.id, {
        name: "first-root",
        parentId: null,
        length: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      });
      registry.addBone(skel.id, {
        name: "second-root",
        parentId: null,
        length: 1,
        position: [1, 0, 0],
        rotation: [0, 0, 0],
      });

      expect(skel.rootBoneId).toBe(first.id);
    });

    it("accepts a custom bone id", () => {
      const skel = registry.create({ name: "test" });
      const bone = registry.addBone(skel.id, {
        id: "my-bone",
        name: "custom",
        parentId: null,
        length: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      });
      expect(bone.id).toBe("my-bone");
    });

    it("throws on duplicate bone id within skeleton", () => {
      const skel = registry.create({ name: "test" });
      registry.addBone(skel.id, {
        id: "dup-bone",
        name: "first",
        parentId: null,
        length: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      });
      expect(() =>
        registry.addBone(skel.id, {
          id: "dup-bone",
          name: "second",
          parentId: null,
          length: 1,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        }),
      ).toThrow('Bone with id "dup-bone" already exists');
    });
  });

  describe("list", () => {
    it("returns all skeletons", () => {
      registry.create({ name: "a" });
      registry.create({ name: "b" });
      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.name)).toEqual(["a", "b"]);
    });

    it("returns empty array when none exist", () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe("clear", () => {
    it("removes all skeletons", () => {
      registry.create({ name: "a" });
      registry.create({ name: "b" });
      registry.clear();
      expect(registry.list()).toEqual([]);
    });
  });
});
