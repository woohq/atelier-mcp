export interface EventMap {
  "server:started": { timestamp: number };
  "server:stopped": { timestamp: number };
  "bridge:connected": { timestamp: number };
  "bridge:disconnected": { reason: string };
  "bridge:crashed": { error: string };
  "scene:object-created": { id: string; type: string };
  "scene:object-removed": { id: string };
  "scene:cleared": { timestamp: number };
  "tool:called": { name: string; requestId: string };
  "tool:completed": { name: string; requestId: string; durationMs: number };
  "tool:error": { name: string; requestId: string; error: string };
  "plugin:loaded": { name: string; path: string };
  "plugin:unloaded": { name: string };
  "plugin:error": { name: string; error: string };
  "aesthetic:loaded": { path: string };
  "render:completed": { durationMs: number };
  "export:completed": { format: string; path: string };
}

export type EventName = keyof EventMap;
