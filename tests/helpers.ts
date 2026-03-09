/**
 * Parse MCP tool result content blocks into typed data.
 */
export function parseToolResult(result: any): { text?: string; data?: any; isError?: boolean } {
  if (!result?.content?.[0]) return {};

  const content = result.content[0];
  const isError = result.isError ?? false;

  if (content.type === "text") {
    try {
      return { text: content.text, data: JSON.parse(content.text), isError };
    } catch {
      return { text: content.text, isError };
    }
  }

  if (content.type === "image") {
    return { data: { base64: content.data, mimeType: content.mimeType }, isError };
  }

  return {};
}
