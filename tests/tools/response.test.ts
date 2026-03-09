import { describe, it, expect } from "vitest";
import { makeTextResponse, makeImageResponse } from "../../src/tools/response.js";

describe("makeTextResponse", () => {
  it("wraps data as JSON text content", () => {
    const result = makeTextResponse({ hello: "world" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ hello: "world" });
  });

  it("handles arrays", () => {
    const result = makeTextResponse([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });
});

describe("makeImageResponse", () => {
  it("wraps base64 as image content", () => {
    const result = makeImageResponse("abc123", "image/png");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("image");
    expect(result.content[0]).toMatchObject({
      data: "abc123",
      mimeType: "image/png",
    });
  });
});
