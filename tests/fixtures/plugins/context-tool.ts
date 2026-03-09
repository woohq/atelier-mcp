import { defineTool } from "../../../src/plugins/define-tool.js";
import { z } from "zod";

export default defineTool({
  name: "context_test_tool",
  description: "A test plugin that uses AtelierContext",
  schema: { index: z.number() },
  handler: async (ctx, atelier) => {
    const objects = atelier.listObjects();
    return { objectCount: objects.length, index: ctx.args.index };
  },
});
