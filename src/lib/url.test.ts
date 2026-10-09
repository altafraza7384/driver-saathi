import { describe, it, expect } from "vitest";
import { safeExternalUrl } from "./url";

describe("safeExternalUrl", () => {
  it("allows https links", () => expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a"));
  it("rejects javascript links", () => expect(safeExternalUrl("javascript:alert(1)")).toBeNull());
  it("rejects data links", () => expect(safeExternalUrl("data:text/html,hi")).toBeNull());
  it("rejects non-URLs", () => expect(safeExternalUrl("not a url")).toBeNull());
});
