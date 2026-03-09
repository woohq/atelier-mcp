import { defineTool } from "../../../src/plugins/define-tool.js";
import { z } from "zod";

export default defineTool({
  name: "test_plugin_tool",
  description: "A test plugin",
  schema: { value: z.string() },
  handler: async (ctx) => {
    return { echo: ctx.args.value };
  },
});
