import { describe, expect, it } from "vitest";
import {
  keyholderQuorumLabel,
  keyholderSigningThreshold,
  releaseSigningThreshold,
} from "./keyholder-quorum";

describe("keyholderSigningThreshold", () => {
  it("matches 2-of-2, 2-of-3, 3-of-5, 5-of-7", () => {
    expect(keyholderSigningThreshold(2)).toBe(2);
    expect(keyholderSigningThreshold(3)).toBe(2);
    expect(keyholderSigningThreshold(5)).toBe(3);
    expect(keyholderSigningThreshold(7)).toBe(5);
    expect(keyholderQuorumLabel(7)).toBe("5-of-7");
    expect(releaseSigningThreshold("single-key-test", 3)).toBe(1);
    expect(releaseSigningThreshold("multisig", 3)).toBe(2);
  });
});
