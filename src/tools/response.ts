/** Maximum response body size in bytes. Responses exceeding this are truncated. */
const MAX_RESPONSE_SIZE = 512 * 1024; // 512 KB

/**
 * Return an image as a native MCP ImageContent block.
 * Expects raw base64 data (no data URI prefix).
 */
export function makeImageResponse(base64: string, mimeType: string) {
  return {
    content: [{ type: "image" as const, data: base64, mimeType }],
  };
}

export function makeTextResponse(data: unknown) {
  const text = JSON.stringify(data, null, 2);

  if (text.length > MAX_RESPONSE_SIZE) {
    if (Array.isArray(data)) {
      const truncated = truncateArray(data);
      if (truncated !== null) {
        const result = JSON.stringify(
          {
            data: truncated.items,
            _truncated: true,
            _message: `Response truncated: showing ${truncated.items.length} of ${data.length} items.`,
          },
          null,
          2,
        );
        return { content: [{ type: "text" as const, text: result }] };
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text:
            `Response too large (${Math.round(text.length / 1024)} KB, limit ${MAX_RESPONSE_SIZE / 1024} KB). ` +
            `Narrow your query.`,
        },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text }],
  };
}

function truncateArray(items: unknown[]): { items: unknown[] } | null {
  const sampleMsg = `Response truncated: showing ${items.length} of ${items.length} items.`;
  const envelopeOverhead = JSON.stringify(
    { data: [], _truncated: true, _message: sampleMsg },
    null,
    2,
  ).length;

  const budget = MAX_RESPONSE_SIZE - envelopeOverhead;
  if (budget <= 0) return null;

  let cumSize = 0;
  let best = 0;
  for (let i = 0; i < items.length; i++) {
    const itemJson = JSON.stringify(items[i], null, 2);
    const lineCount = itemJson.split("\n").length;
    const indentOverhead = lineCount * 4;
    const separatorCost = i > 0 ? 2 : 0;
    cumSize += itemJson.length + indentOverhead + separatorCost;
    if (cumSize <= budget) {
      best = i + 1;
    } else {
      break;
    }
  }

  if (best === 0) return null;
  return { items: items.slice(0, best) };
}
