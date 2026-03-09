import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

export function registerAnimationTools(server: AtelierMcpServer): void {
  // --- create_skeleton ---
  server.registry.register({
    name: "create_skeleton",
    description:
      "Create a new skeleton for skeletal animation. " +
      "Returns the skeleton ID. Add bones with add_bone, then bind to a mesh with skin_mesh.",
    schema: {
      name: z.string().describe("Display name for the skeleton"),
    },
    handler: async (ctx) => {
      const skeleton = server.skeletons.create({ name: ctx.args.name });

      await server.bridge.execute("createSkeleton", {
        id: skeleton.id,
        name: skeleton.name,
      });

      return makeTextResponse({ id: skeleton.id, name: skeleton.name });
    },
  });

  // --- add_bone ---
  server.registry.register({
    name: "add_bone",
    description:
      "Add a bone to an existing skeleton. " +
      "If parentBoneId is omitted, the bone is added as a root bone. " +
      "Position and rotation are relative to the parent bone.",
    schema: {
      skeletonId: z.string().describe("ID of the skeleton to add the bone to"),
      name: z.string().describe("Display name for the bone"),
      parentBoneId: z.string().optional().describe("ID of the parent bone (omit for root bone)"),
      length: z.number().positive().describe("Length of the bone"),
      position: z
        .tuple([z.number(), z.number(), z.number()])
        .describe("Position offset [x, y, z] relative to parent"),
      rotation: z
        .tuple([z.number(), z.number(), z.number()])
        .describe("Rotation [x, y, z] in radians relative to parent"),
    },
    handler: async (ctx) => {
      const { skeletonId, name, parentBoneId, length, position, rotation } = ctx.args;

      const bone = server.skeletons.addBone(skeletonId, {
        name,
        parentId: parentBoneId ?? null,
        length,
        position,
        rotation,
      });

      await server.bridge.execute("addBone", {
        skeletonId,
        boneId: bone.id,
        name: bone.name,
        parentBoneId: bone.parentId,
        length: bone.length,
        position: bone.position,
        rotation: bone.rotation,
      });

      return makeTextResponse({
        id: bone.id,
        name: bone.name,
        skeletonId,
        parentBoneId: bone.parentId,
      });
    },
  });

  // --- skin_mesh ---
  server.registry.register({
    name: "skin_mesh",
    description:
      "Bind a skeleton to a mesh, creating a skinned mesh for skeletal animation. " +
      "If weights are omitted, they are auto-generated based on vertex distance to bones. " +
      "Replaces the original mesh in the scene.",
    schema: {
      meshId: z.string().describe("ID of the mesh to skin"),
      skeletonId: z.string().describe("ID of the skeleton to bind"),
      weights: z
        .array(
          z.object({
            vertexIndex: z.number().int().min(0),
            boneId: z.string(),
            weight: z.number().min(0).max(1),
          }),
        )
        .optional()
        .describe("Explicit bone weights per vertex (auto-generated if omitted)"),
    },
    handler: async (ctx) => {
      const { meshId, skeletonId, weights } = ctx.args;

      // Validate skeleton exists server-side
      const skeleton = server.skeletons.get(skeletonId);
      if (!skeleton) {
        return makeTextResponse({ error: `Skeleton "${skeletonId}" not found` });
      }

      await server.bridge.execute("skinMesh", {
        meshId,
        skeletonId,
        weights: weights ?? null,
      });

      return makeTextResponse({
        meshId,
        skeletonId,
        skinned: true,
        autoWeights: !weights,
      });
    },
  });

  // --- create_animation_clip ---
  server.registry.register({
    name: "create_animation_clip",
    description:
      "Create a new animation clip. Add keyframes with add_keyframe, then play with play_animation.",
    schema: {
      name: z.string().describe("Display name for the animation clip"),
      duration: z.number().positive().describe("Duration of the clip in seconds"),
      loop: z.boolean().default(false).describe("Whether the animation loops"),
    },
    handler: async (ctx) => {
      const clip = server.animations.create({
        name: ctx.args.name,
        duration: ctx.args.duration,
        loop: ctx.args.loop,
      });

      await server.bridge.execute("createAnimationClip", {
        id: clip.id,
        name: clip.name,
        duration: clip.duration,
        loop: clip.loop,
      });

      return makeTextResponse({
        id: clip.id,
        name: clip.name,
        duration: clip.duration,
        loop: clip.loop,
      });
    },
  });

  // --- add_keyframe ---
  server.registry.register({
    name: "add_keyframe",
    description:
      "Add a keyframe to an animation clip. " +
      "Each keyframe targets a bone at a specific time with optional position, rotation, and scale.",
    schema: {
      clipId: z.string().describe("ID of the animation clip"),
      boneId: z.string().describe("ID of the bone this keyframe targets"),
      time: z.number().min(0).describe("Time in seconds within the clip"),
      position: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("Bone position [x, y, z] at this keyframe"),
      rotation: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("Bone rotation [x, y, z] in radians at this keyframe"),
      scale: z
        .tuple([z.number(), z.number(), z.number()])
        .optional()
        .describe("Bone scale [x, y, z] at this keyframe"),
      easing: z
        .enum(["linear", "ease-in", "ease-out", "ease-in-out"])
        .default("linear")
        .describe("Easing function for interpolation to next keyframe"),
    },
    handler: async (ctx) => {
      const { clipId, boneId, time, position, rotation, scale, easing } = ctx.args;

      server.animations.addKeyframe(clipId, {
        time,
        boneId,
        position,
        rotation,
        scale,
        easing,
      });

      await server.bridge.execute("addKeyframe", {
        clipId,
        boneId,
        time,
        position: position ?? null,
        rotation: rotation ?? null,
        scale: scale ?? null,
        easing,
      });

      return makeTextResponse({ clipId, boneId, time, easing });
    },
  });

  // --- play_animation ---
  server.registry.register({
    name: "play_animation",
    description:
      "Play an animation clip on a skinned mesh. " +
      "Creates an AnimationMixer and starts playback. " +
      "Use render_preview to see the animation in action.",
    schema: {
      objectId: z.string().describe("ID of the SkinnedMesh to animate"),
      clipId: z.string().describe("ID of the animation clip to play"),
    },
    handler: async (ctx) => {
      const { objectId, clipId } = ctx.args;

      const clip = server.animations.get(clipId);
      if (!clip) {
        return makeTextResponse({ error: `Animation clip "${clipId}" not found` });
      }

      await server.bridge.execute("playAnimation", {
        objectId,
        clipId,
      });

      return makeTextResponse({
        objectId,
        clipId,
        playing: true,
        duration: clip.duration,
        loop: clip.loop,
      });
    },
  });

  // --- set_animation_frame ---
  server.registry.register({
    name: "set_animation_frame",
    description:
      "Seek an animation to a specific time for posing or frame preview. " +
      "Pauses playback at the given time. Use render_preview to capture the pose.",
    schema: {
      objectId: z.string().describe("ID of the animated SkinnedMesh"),
      clipId: z.string().describe("ID of the animation clip"),
      time: z.number().min(0).describe("Time in seconds to seek to"),
    },
    handler: async (ctx) => {
      const { objectId, clipId, time } = ctx.args;

      const clip = server.animations.get(clipId);
      if (!clip) {
        return makeTextResponse({ error: `Animation clip "${clipId}" not found` });
      }

      await server.bridge.execute("setAnimationFrame", {
        objectId,
        clipId,
        time,
      });

      return makeTextResponse({
        objectId,
        clipId,
        time,
        paused: true,
      });
    },
  });
}
