import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";

const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

export function registerParticleTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "create_emitter",
    description:
      "Create a particle emitter. Emits particles from a point with configurable physics.",
    schema: {
      count: z.number().int().min(1).max(10000).default(100).describe("Number of particles"),
      lifetime: z.number().positive().default(2).describe("Particle lifetime in seconds"),
      speed: z.number().min(0).default(1).describe("Initial emission speed"),
      spread: z
        .number()
        .min(0)
        .max(Math.PI)
        .default(0.5)
        .describe("Emission cone spread"),
      gravity: z.number().default(-0.5).describe("Gravity force (negative = down)"),
      colorStart: z
        .union([z.string(), z.number().int()])
        .optional()
        .describe("Particle color"),
      size: z.number().positive().default(0.05).describe("Particle size"),
      position: vec3Schema.optional().describe("Emitter position [x, y, z]"),
    },
    handler: async (ctx) => {
      const id = server.scene.generateId("emitter");
      server.scene.create({ id, name: id, type: "emitter", metadata: ctx.args });
      const result = await server.bridge.execute("createEmitter", { id, ...ctx.args });
      return makeTextResponse({ id, ...(result as object) });
    },
  });

  server.registry.register({
    name: "set_emitter_param",
    description: "Update parameters on an existing particle emitter at runtime.",
    schema: {
      emitterId: z.string().describe("ID of the emitter"),
      updates: z
        .record(z.unknown())
        .describe("Parameters to update (speed, gravity, colorStart, size, etc.)"),
    },
    handler: async (ctx) => {
      const result = await server.bridge.execute("setEmitterParam", ctx.args);
      return makeTextResponse(result);
    },
  });
}
