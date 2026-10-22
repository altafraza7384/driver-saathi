import { describe, it, expect } from "vitest";
import { encodeGeohash, approxCoord } from "./geohash";

describe("encodeGeohash", () => {
  it("matches the well-known reference vector", () => {
    // Reference: geohash.org / Wikipedia example.
    expect(encodeGeohash(57.64911, 10.40744, 11)).toBe("u4pruydqqvj");
  });

  it("respects the requested precision", () => {
    expect(encodeGeohash(19.076, 72.8777, 7)).toHaveLength(7);
    expect(encodeGeohash(19.076, 72.8777, 5)).toHaveLength(5);
  });

  it("gives different hashes for far-apart places", () => {
    expect(encodeGeohash(19.076, 72.8777, 7)).not.toBe(
      encodeGeohash(28.6139, 77.209, 7),
    );
  });
});

describe("approxCoord", () => {
  it("rounds to two decimals", () => {
    expect(approxCoord(19.07642)).toBe(19.08);
    expect(approxCoord(72.8777)).toBe(72.88);
  });
});
