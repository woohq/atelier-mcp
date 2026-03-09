export enum ErrorCode {
  // Bridge errors
  BRIDGE_NOT_CONNECTED = "BRIDGE_NOT_CONNECTED",
  BRIDGE_LAUNCH_FAILED = "BRIDGE_LAUNCH_FAILED",
  BRIDGE_CRASHED = "BRIDGE_CRASHED",

  // Render errors
  RENDER_TIMEOUT = "RENDER_TIMEOUT",
  RENDER_FAILED = "RENDER_FAILED",

  // Shader errors
  SHADER_COMPILE_ERROR = "SHADER_COMPILE_ERROR",

  // Plugin errors
  PLUGIN_LOAD_ERROR = "PLUGIN_LOAD_ERROR",
  PLUGIN_INVALID = "PLUGIN_INVALID",

  // Scene errors
  OBJECT_NOT_FOUND = "OBJECT_NOT_FOUND",
  INVALID_OPERATION = "INVALID_OPERATION",

  // Export errors
  EXPORT_FAILED = "EXPORT_FAILED",

  // General
  TOOL_TIMEOUT = "TOOL_TIMEOUT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export class AtelierError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AtelierError";
  }
}
