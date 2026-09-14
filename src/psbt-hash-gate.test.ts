import { describe, expect, it } from "vitest";
import {
  challengeWindowDays,
  hashGateHtml,
  hashGateState,
  sha256HexOfPsbtBase64,
} from "./psbt-hash-gate";

const SAMPLE = "cHNidP8BAAD4";
/** Same digest as workers/src/lib/bytes.test.ts — raw bytes, not the base64 string. */
const SAMPLE_SHA256 =
  "fa8a9e3501fa9b40ad5a837e8ae3cedddee54a46a44cd81c96d6e4e53cbb20db";

describe("challengeWindowDays", () => {
  it("scales 7 / 14 / 30", () => {
    expect(challengeWindowDays(999_999)).toBe(7);
    expect(challengeWindowDays(1_000_000)).toBe(14);
    expect(challengeWindowDays(10_000_000)).toBe(14);
    expect(challengeWindowDays(10_000_001)).toBe(30);
  });
});

describe("hashGateState", () => {
  it("matches published SHA-256 of raw PSBT bytes", async () => {
    const hex = await sha256HexOfPsbtBase64(SAMPLE);
    expect(hex).toBe(SAMPLE_SHA256);
    expect(await hashGateState("", hex)).toBe("empty");
    expect(await hashGateState("%%%", hex)).toBe("invalid");
    expect(await hashGateState(SAMPLE, undefined)).toBe("no-published");
    expect(await hashGateState(SAMPLE, hex)).toBe("match");
    expect(await hashGateState(SAMPLE, "ab".repeat(32))).toBe("mismatch");
  });

  it("renders a verify field without embedding the transaction", () => {
    const html = hashGateHtml({
      publishedHash: "aa".repeat(32),
      inputId: "kh-psbt-verify",
      statusId: "kh-hash-status",
    });
    expect(html).toContain('id="kh-psbt-verify"');
    expect(html).toContain('id="kh-hash-status"');
    expect(html).toContain("Published SHA-256");
    expect(html).not.toContain(SAMPLE);
  });
});
