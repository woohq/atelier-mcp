import type { AtelierMcpServer } from "../../server/server.js";
import { registerAestheticTools } from "./aesthetic-tools.js";
import { registerAnimationTools } from "./animation-tools.js";
import { registerCanvasTools } from "./canvas-tools.js";
import { registerExportTools } from "./export-tools.js";
import { registerImportTools } from "./import-tools.js";
import { registerGeometryTools } from "./geometry-tools.js";
import { registerMaterialTools } from "./material-tools.js";
import { registerModelingTools } from "./modeling-tools.js";
import { registerProceduralTools } from "./procedural-tools.js";
import { registerRenderPreview } from "./render-preview.js";
import { registerSceneTools } from "./scene-tools.js";
import { registerSessionTools } from "./session-tools.js";
import { registerShaderTools } from "./shader-tools.js";
import { registerStyleTools } from "./style-tools.js";
import { registerVariationTools } from "./variation-tools.js";

export function registerBuiltinTools(server: AtelierMcpServer): void {
  registerRenderPreview(server);
  registerCanvasTools(server);
  registerGeometryTools(server);
  registerMaterialTools(server);
  registerSceneTools(server);
  registerAnimationTools(server);
  registerAestheticTools(server);
  registerShaderTools(server);
  registerModelingTools(server);
  registerExportTools(server);
  registerSessionTools(server);
  registerProceduralTools(server);
  registerStyleTools(server);
  registerVariationTools(server);
  registerImportTools(server);
}
