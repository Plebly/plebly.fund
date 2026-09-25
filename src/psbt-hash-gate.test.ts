import { describe, expect, it } from "vitest";
import {
  bindHashGate,
  challengeWindowDays,
  hashGateActionEnabled,
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
    expect(html).toContain("Unsigned transaction you received (base64)");
    expect(html).not.toContain(SAMPLE);
  });

  it("accepts paste-label override to distinguish PSBT from settle txid", () => {
    const html = hashGateHtml({
      publishedHash: "aa".repeat(32),
      inputId: "branch-psbt-verify",
      statusId: "branch-hash-status",
      pasteLabel: "Release PSBT (base64) — not a settle txid",
      placeholder: "Paste unsigned Release PSBT to verify SHA-256",
    });
    expect(html).toContain("Release PSBT (base64) — not a settle txid");
    expect(html).toContain("Paste unsigned Release PSBT to verify SHA-256");
    expect(html).not.toContain(SAMPLE);
  });
});

describe("hashGateActionEnabled", () => {
  it("stays disabled on hash match when extra (signed partial) is empty", () => {
    expect(
      hashGateActionEnabled({
        state: "match",
        hasPublishedHash: true,
        extraOk: false,
      }),
    ).toBe(false);
  });

  it("enables on hash match when extra (signed partial) is non-empty", () => {
    expect(
      hashGateActionEnabled({
        state: "match",
        hasPublishedHash: true,
        extraOk: true,
      }),
    ).toBe(true);
  });

  it("ignores extra when not provided (copy-for-Sparrow style gates)", () => {
    expect(
      hashGateActionEnabled({
        state: "match",
        hasPublishedHash: true,
      }),
    ).toBe(true);
    expect(
      hashGateActionEnabled({
        state: "mismatch",
        hasPublishedHash: true,
      }),
    ).toBe(false);
  });

  it("requires extra even when enableActionWithoutHash allows no published hash", () => {
    expect(
      hashGateActionEnabled({
        state: "empty",
        hasPublishedHash: false,
        enableActionWithoutHash: true,
        extraOk: false,
      }),
    ).toBe(false);
    expect(
      hashGateActionEnabled({
        state: "empty",
        hasPublishedHash: false,
        enableActionWithoutHash: true,
        extraOk: true,
      }),
    ).toBe(true);
  });

  it("stays disabled without published hash when enableActionWithoutHash is false", () => {
    expect(
      hashGateActionEnabled({
        state: "empty",
        hasPublishedHash: false,
        enableActionWithoutHash: false,
        extraOk: true,
      }),
    ).toBe(false);
  });
});

describe("bindHashGate download", () => {
  it("marks a matching download without filling the paste box", async () => {
    document.body.innerHTML = `<textarea id="v"></textarea><p id="s"></p><button id="a"></button>`;
    const gate = bindHashGate({
      input: document.querySelector("#v"),
      status: document.querySelector("#s"),
      publishedHash: SAMPLE_SHA256,
      action: document.querySelector("#a"),
    });
    await gate.acceptDownload(SAMPLE);
    const box = document.querySelector<HTMLTextAreaElement>("#v");
    expect(box?.value).toBe("");
    expect(document.querySelector("#s")?.textContent).toBe(
      "SHA-256 matches the file you downloaded.",
    );
  });
});
