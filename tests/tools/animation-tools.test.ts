import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/tools/tool-registry.js";
import { SkeletonRegistry } from "../../src/animation/skeleton.js";
import { AnimationClipRegistry } from "../../src/animation/animation-clip.js";
import { registerAnimationTools } from "../../src/tools/builtin/animation-tools.js";

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

function createMockServer() {
  const registry = new ToolRegistry();
  const skeletons = new SkeletonRegistry();
  const animations = new AnimationClipRegistry();
  const bridge = { execute: vi.fn().mockResolvedValue({ ok: true }), getScreenshot: vi.fn() };
  const server = { registry, skeletons, animations, bridge } as any;
  registerAnimationTools(server);
  return { server, registry, skeletons, animations, bridge };
}

describe("Animation Tools", () => {
  let registry: ToolRegistry;
  let skeletons: SkeletonRegistry;
  let animations: AnimationClipRegistry;
  let bridge: any;

  beforeEach(() => {
    ({ registry, skeletons, animations, bridge } = createMockServer());
  });

  describe("create_skeleton", () => {
    it("registers the tool", () => {
      expect(registry.has("create_skeleton")).toBe(true);
    });

    it("creates a skeleton and sends bridge command", async () => {
      const tool = registry.get("create_skeleton")!;
      const result = await tool.handler({
        toolName: "create_skeleton",
        args: { name: "humanoid" },
      });
      const data = parseResult(result);

      expect(data.id).toMatch(/^skel_/);
      expect(data.name).toBe("humanoid");
      expect(skeletons.list()).toHaveLength(1);
      expect(bridge.execute).toHaveBeenCalledWith("createSkeleton", {
        id: data.id,
        name: "humanoid",
      });
    });
  });

  describe("add_bone", () => {
    it("registers the tool", () => {
      expect(registry.has("add_bone")).toBe(true);
    });

    it("adds a root bone", async () => {
      const skel = skeletons.create({ name: "test" });
      const tool = registry.get("add_bone")!;
      const result = await tool.handler({
        toolName: "add_bone",
        args: {
          skeletonId: skel.id,
          name: "spine",
          length: 1.5,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
        },
      });
      const data = parseResult(result);

      expect(data.id).toMatch(/^bone_/);
      expect(data.name).toBe("spine");
      expect(data.skeletonId).toBe(skel.id);
      expect(data.parentBoneId).toBeNull();
      expect(skel.bones.size).toBe(1);
      expect(bridge.execute).toHaveBeenCalledWith(
        "addBone",
        expect.objectContaining({
          skeletonId: skel.id,
          name: "spine",
          parentBoneId: null,
        }),
      );
    });

    it("adds a child bone", async () => {
      const skel = skeletons.create({ name: "test" });
      const root = skeletons.addBone(skel.id, {
        name: "root",
        parentId: null,
        length: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      });

      const tool = registry.get("add_bone")!;
      const result = await tool.handler({
        toolName: "add_bone",
        args: {
          skeletonId: skel.id,
          name: "arm",
          parentBoneId: root.id,
          length: 0.8,
          position: [0.5, 1, 0] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
        },
      });
      const data = parseResult(result);

      expect(data.parentBoneId).toBe(root.id);
      expect(skel.bones.size).toBe(2);
    });

    it("throws for unknown skeleton", async () => {
      const tool = registry.get("add_bone")!;
      await expect(
        tool.handler({
          toolName: "add_bone",
          args: {
            skeletonId: "nope",
            name: "bone",
            length: 1,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
          },
        }),
      ).rejects.toThrow('Skeleton "nope" not found');
    });
  });

  describe("skin_mesh", () => {
    it("registers the tool", () => {
      expect(registry.has("skin_mesh")).toBe(true);
    });

    it("skins a mesh with auto-weights", async () => {
      const skel = skeletons.create({ name: "test" });
      skeletons.addBone(skel.id, {
        name: "root",
        parentId: null,
        length: 1,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      });

      const tool = registry.get("skin_mesh")!;
      const result = await tool.handler({
        toolName: "skin_mesh",
        args: { meshId: "mesh_1", skeletonId: skel.id },
      });
      const data = parseResult(result);

      expect(data.meshId).toBe("mesh_1");
      expect(data.skeletonId).toBe(skel.id);
      expect(data.skinned).toBe(true);
      expect(data.autoWeights).toBe(true);
      expect(bridge.execute).toHaveBeenCalledWith("skinMesh", {
        meshId: "mesh_1",
        skeletonId: skel.id,
        weights: null,
      });
    });

    it("returns error for unknown skeleton", async () => {
      const tool = registry.get("skin_mesh")!;
      const result = await tool.handler({
        toolName: "skin_mesh",
        args: { meshId: "mesh_1", skeletonId: "nope" },
      });
      const data = parseResult(result);

      expect(data.error).toContain("not found");
    });
  });

  describe("create_animation_clip", () => {
    it("registers the tool", () => {
      expect(registry.has("create_animation_clip")).toBe(true);
    });

    it("creates a clip and sends bridge command", async () => {
      const tool = registry.get("create_animation_clip")!;
      const result = await tool.handler({
        toolName: "create_animation_clip",
        args: { name: "walk", duration: 2.0, loop: true },
      });
      const data = parseResult(result);

      expect(data.id).toMatch(/^clip_/);
      expect(data.name).toBe("walk");
      expect(data.duration).toBe(2.0);
      expect(data.loop).toBe(true);
      expect(animations.list()).toHaveLength(1);
      expect(bridge.execute).toHaveBeenCalledWith("createAnimationClip", {
        id: data.id,
        name: "walk",
        duration: 2.0,
        loop: true,
      });
    });
  });

  describe("add_keyframe", () => {
    it("registers the tool", () => {
      expect(registry.has("add_keyframe")).toBe(true);
    });

    it("adds a keyframe and sends bridge command", async () => {
      const clip = animations.create({ name: "test", duration: 2 });

      const tool = registry.get("add_keyframe")!;
      const result = await tool.handler({
        toolName: "add_keyframe",
        args: {
          clipId: clip.id,
          boneId: "bone_1",
          time: 0.5,
          position: [1, 2, 3] as [number, number, number],
          easing: "ease-in",
        },
      });
      const data = parseResult(result);

      expect(data.clipId).toBe(clip.id);
      expect(data.boneId).toBe("bone_1");
      expect(data.time).toBe(0.5);
      expect(clip.keyframes).toHaveLength(1);
      expect(bridge.execute).toHaveBeenCalledWith("addKeyframe", {
        clipId: clip.id,
        boneId: "bone_1",
        time: 0.5,
        position: [1, 2, 3],
        rotation: null,
        scale: null,
        easing: "ease-in",
      });
    });

    it("throws for unknown clip", async () => {
      const tool = registry.get("add_keyframe")!;
      await expect(
        tool.handler({
          toolName: "add_keyframe",
          args: { clipId: "nope", boneId: "b", time: 0, easing: "linear" },
        }),
      ).rejects.toThrow('Animation clip "nope" not found');
    });
  });

  describe("play_animation", () => {
    it("registers the tool", () => {
      expect(registry.has("play_animation")).toBe(true);
    });

    it("plays animation and sends bridge command", async () => {
      const clip = animations.create({ name: "walk", duration: 2, loop: true });

      const tool = registry.get("play_animation")!;
      const result = await tool.handler({
        toolName: "play_animation",
        args: { objectId: "mesh_1", clipId: clip.id },
      });
      const data = parseResult(result);

      expect(data.objectId).toBe("mesh_1");
      expect(data.clipId).toBe(clip.id);
      expect(data.playing).toBe(true);
      expect(data.duration).toBe(2);
      expect(data.loop).toBe(true);
      expect(bridge.execute).toHaveBeenCalledWith("playAnimation", {
        objectId: "mesh_1",
        clipId: clip.id,
      });
    });

    it("returns error for unknown clip", async () => {
      const tool = registry.get("play_animation")!;
      const result = await tool.handler({
        toolName: "play_animation",
        args: { objectId: "mesh_1", clipId: "nope" },
      });
      const data = parseResult(result);

      expect(data.error).toContain("not found");
    });
  });

  describe("set_animation_frame", () => {
    it("registers the tool", () => {
      expect(registry.has("set_animation_frame")).toBe(true);
    });

    it("seeks to a frame and sends bridge command", async () => {
      const clip = animations.create({ name: "walk", duration: 2 });

      const tool = registry.get("set_animation_frame")!;
      const result = await tool.handler({
        toolName: "set_animation_frame",
        args: { objectId: "mesh_1", clipId: clip.id, time: 1.5 },
      });
      const data = parseResult(result);

      expect(data.objectId).toBe("mesh_1");
      expect(data.clipId).toBe(clip.id);
      expect(data.time).toBe(1.5);
      expect(data.paused).toBe(true);
      expect(bridge.execute).toHaveBeenCalledWith("setAnimationFrame", {
        objectId: "mesh_1",
        clipId: clip.id,
        time: 1.5,
      });
    });

    it("returns error for unknown clip", async () => {
      const tool = registry.get("set_animation_frame")!;
      const result = await tool.handler({
        toolName: "set_animation_frame",
        args: { objectId: "mesh_1", clipId: "nope", time: 0 },
      });
      const data = parseResult(result);

      expect(data.error).toContain("not found");
    });
  });
});
