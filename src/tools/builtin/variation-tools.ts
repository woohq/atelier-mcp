import { z } from "zod";
import type { AtelierMcpServer } from "../../server/server.js";
import { makeTextResponse } from "../response.js";
import { AtelierError, ErrorCode } from "../../types/errors.js";
import { SeededRNG } from "../../util/rng.js";

export function registerVariationTools(server: AtelierMcpServer): void {
  server.registry.register({
    name: "create_variations",
    description:
      "Create variations of an existing object. Clones the source N times with seeded " +
      "randomized perturbations to scale, rotation, and color. " +
      "Optionally arrange in a grid or row layout for comparison.",
    schema: {
      sourceObjectId: z
        .string()
        .describe("ID of the source object to create variations of"),
      count: z
        .number()
        .int()
        .min(1)
        .max(50)
        .describe("Number of variations to create"),
      seed: z
        .number()
        .int()
        .default(42)
        .describe("Random seed for deterministic variations"),
      axes: z
        .array(
          z.object({
            property: z
              .enum(["scale", "rotation", "color"])
              .describe("Property to vary"),
            amount: z
              .number()
              .min(0)
              .max(1)
              .describe("Variation amount (0=none, 1=max)"),
          }),
        )
        .min(1)
        .describe("Which properties to vary and by how much"),
      layout: z
        .enum(["grid", "row", "none"])
        .default("row")
        .describe("How to arrange variations"),
      spacing: z
        .number()
        .positive()
        .default(2)
        .describe("Spacing between variations"),
    },
    handler: async (ctx) => {
      const { sourceObjectId, count, seed, axes, layout, spacing } = ctx.args;
      const obj = server.scene.get(sourceObjectId);
      if (!obj) {
        throw new AtelierError(
          ErrorCode.OBJECT_NOT_FOUND,
          `Object "${sourceObjectId}" not found`,
        );
      }

      const rng = new SeededRNG(seed);
      const ids: string[] = [];

      for (let i = 0; i < count; i++) {
        const newId = server.scene.generateId("variation");
        server.scene.create({
          id: newId,
          name: newId,
          type: obj.type,
          metadata: {
            ...obj.metadata,
            variationOf: sourceObjectId,
            variationIndex: i,
          },
        });

        // Compute position based on layout
        let position: [number, number, number] = [0, 0, 0];
        if (layout === "row") {
          position = [(i + 1) * spacing, 0, 0];
        } else if (layout === "grid") {
          const cols = Math.ceil(Math.sqrt(count));
          const col = i % cols;
          const row = Math.floor(i / cols);
          position = [(col + 1) * spacing, 0, (row + 1) * spacing];
        }

        // Compute variation transforms
        let scale: [number, number, number] = [1, 1, 1];
        let rotation: [number, number, number] = [0, 0, 0];
        let colorShift: number | undefined;

        for (const axis of axes) {
          switch (axis.property) {
            case "scale": {
              const sv = 1 + (rng.next() - 0.5) * axis.amount;
              scale = [sv, sv, sv];
              break;
            }
            case "rotation": {
              rotation = [
                rng.range(-Math.PI, Math.PI) * axis.amount,
                rng.range(-Math.PI, Math.PI) * axis.amount,
                rng.range(-Math.PI, Math.PI) * axis.amount,
              ];
              break;
            }
            case "color": {
              colorShift = rng.range(
                -axis.amount * 0.3,
                axis.amount * 0.3,
              );
              break;
            }
          }
        }

        await server.bridge.execute("cloneObject", {
          sourceId: sourceObjectId,
          newId,
          position,
          rotation,
          scale,
          colorShift,
        });

        ids.push(newId);
      }

      return makeTextResponse({ sourceObjectId, count, ids, seed, layout });
    },
  });
}
