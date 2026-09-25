import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  branchSignDeskHtml,
  branchSignChipLabel,
  branchSignNextAction,
  cashoutDeskHtml,
  keyholderProofWizardHtml,
  keyholderReceiveAddress,
  keyholderSessionStale,
  keyholderSessionNeedsReauth,
  KEYHOLDER_SESSION_MAX_AGE_MS,
  KEYHOLDER_REAUTH_WARN_MS,
  saveSettleDraft,
  readSettleDraft,
  clearSettleDraft,
  settleToastTxidPrefix,
  keyholderSettleToastText,
  keyholderPageToastHtml,
  parseKeyholderReturnState,
  receiveAddressUnchanged,
  keyholderDeskHtml,
  keyholderRosterHtml,
  keyholderDeskStep,
  keyholderColdStart,
  keyholderColdStartHtml,
  keyholderKeysFormHtml,
  keyholderOnboardHtml,
  keyholderOnboardLede,
  keyholderOnboardPhase,
  keyholderOnboardStepIndex,
  keyholderPackageSentence,
  keyholderTabFromSearch,
  keyholderTxPurpose,
  keyholderQueueEmptyHtml,
  signatureProgressLabel,
  shortSettleTxid,
  SIGNET_23_JOIN_SHEET,
} from "./keyholders-page";
import { parseLocation, seoForRoute } from "./router";

describe("keyholders route", () => {
  it("parses /keyholders", () => {
    expect(parseLocation("/keyholders", "")).toEqual({ name: "keyholders" });
    const seo = seoForRoute({ name: "keyholders" });
    expect(seo.path).toBe("/keyholders");
    expect(seo.title).toMatch(/Keyholder/i);
    expect(keyholderTabFromSearch("?tab=branch")).toBe("branch");
    expect(keyholderTabFromSearch("")).toBe("release");
  });
});

describe("keyholderQueueEmptyHtml", () => {
  it("uses compact empty-state chrome for nothing-to-sign queues", () => {
    const html = keyholderQueueEmptyHtml(
      "Nothing to sign",
      "No open release items.",
    );
    expect(html).toContain("empty-state");
    expect(html).toContain("empty-state-compact");
    expect(html).toContain("kh-queue-empty");
    expect(html).toContain("Nothing to sign");
    expect(html).toContain("No open release items.");
  });
});

describe("keyholderPackageSentence", () => {
  it("asks to sign a ready release and stays quiet otherwise", () => {
    expect(
      keyholderPackageSentence({
        kind: "release",
        outputs: [{ address: "tb1q", amount_sats: 1 }],
      }),
    ).toBe("Sign this release.");
    expect(
      keyholderPackageSentence({
        kind: "release",
        monthly_accruing: true,
        outputs: [{ address: "tb1q", amount_sats: 1 }],
      }),
    ).toBeNull();
    expect(keyholderPackageSentence({ kind: "release", outputs: [] })).toBeNull();
    expect(
      keyholderPackageSentence({
        kind: "refund",
        outputs: [{ address: "tb1q", amount_sats: 1 }],
      }),
    ).toBeNull();
  });

  it("steps a ready release: freeze, then sign, then broadcast", () => {
    expect(
      keyholderDeskStep({
        kind: "release",
        outputs: [{}],
        canUnsigned: true,
        canPartial: false,
        canBroadcast: false,
        isRelease: true,
        needsLn: false,
      }),
    ).toBe("freeze");
    expect(
      keyholderDeskStep({
        kind: "release",
        outputs: [{}],
        canUnsigned: false,
        canPartial: true,
        canBroadcast: false,
        isRelease: true,
        needsLn: false,
      }),
    ).toBe("sign");
    expect(
      keyholderDeskStep({
        kind: "release",
        outputs: [{}],
        canUnsigned: false,
        canPartial: true,
        canBroadcast: true,
        isRelease: true,
        needsLn: false,
      }),
    ).toBe("broadcast");
  });

  it("desk shows the current step and keeps sign/verify/output ids", () => {
    const html = keyholderDeskHtml(
      {
        kind: "release",
        proposal_id: "p1",
        state: "ready",
        outputs: [{ address: "tb1qout", amount_sats: 50_000, label: "builder" }],
        required_threshold: 3,
        partials: [],
      },
      {
        needsLn: false,
        canPsbt: true,
        canUnsigned: false,
        canPartial: true,
        canBroadcast: false,
        isRelease: true,
        requiresDualSettle: true,
        userId: "github:1",
      },
    );
    expect(html).toContain("Sign this release.");
    expect(html).toContain("kh-steps");
    expect(html).toContain("is-current");
    expect(html).toContain('id="kh-sign"');
    expect(html).toContain('id="kh-psbt-verify"');
    expect(html).toContain('id="kh-hash-status"');
    expect(html).toContain('id="kh-verify-panel"');
    expect(html).toContain("kh-outputs");
    expect(html).toContain("Other settle tools");
    expect(html).toContain("Settle txid (64 hex) — not a PSBT");
    expect(html).toContain("Waiting for 0/3 cosignatures before broadcast");
    expect(html).not.toContain("cHNidP8");
    // Copy may say "not a PSBT"; never embed PSBT payload bytes.
    expect(html).not.toMatch(/cHNidP8|psbt_base64/i);
  });

  it("bond_refund shows settle txid + Propose settle as primary (not only in details)", () => {
    const html = keyholderDeskHtml(
      {
        kind: "bond_refund",
        proposal_id: "PLEBLY-2026-003",
        state: "ready",
        outputs: [
          {
            address: "tb1q0za7fw3vvwevpkxxcev0z2g9dzgq2fe8d6vey8",
            amount_sats: 10_000,
            label: "bond refund",
          },
        ],
        required_threshold: 0,
        partials: [],
      },
      {
        needsLn: false,
        canPsbt: true,
        canUnsigned: false,
        canPartial: false,
        canBroadcast: false,
        isRelease: false,
        requiresDualSettle: false,
        userId: "github:1",
      },
    );
    expect(html).toContain("Return funds.");
    expect(html).toContain('data-kh-settle-primary="1"');
    expect(html).toContain("Settle · record broadcast");
    expect(html).toContain('id="kh-txid"');
    expect(html).toContain("Settle txid (64 hex) — not a PSBT");
    expect(html).toContain("fee-pay-bond-label");
    expect(html).toContain("fee-pay-bond-contrast");
    expect(html).toContain("fee/bond Sparrow wallet");
    expect(html).toContain("Propose settle");
    expect(html).not.toContain("Confirm settle");
    // Primary settle controls must appear before the collapsed details.
    const txidAt = html.indexOf('id="kh-txid"');
    const proposeAt = html.indexOf('id="kh-propose"');
    const detailsAt = html.indexOf('<details class="next-card-more">');
    expect(txidAt).toBeGreaterThan(-1);
    expect(proposeAt).toBeGreaterThan(-1);
    expect(detailsAt).toBeGreaterThan(-1);
    expect(txidAt).toBeLessThan(detailsAt);
    expect(proposeAt).toBeLessThan(detailsAt);
    // Details is chat-only for non-release; settle is not buried there alone.
    expect(html).toContain("<summary>Keyholder chat</summary>");
    expect(html).not.toContain("<summary>Other settle tools</summary>");
    // No Confirm settle when dual-ack is not required (bond_refund).
    expect(html).not.toContain('id="kh-confirm"');
  });

  it("contrib_refund also promotes settle primary; dual-settle keeps Confirm", () => {
    const html = keyholderDeskHtml(
      {
        kind: "contrib_refund",
        proposal_id: "PLEBLY-2026-009",
        state: "ready",
        outputs: [{ address: "tb1qout", amount_sats: 5_000, label: "refund" }],
        settle_proposed_by: "github:2",
      },
      {
        needsLn: false,
        canPsbt: true,
        canUnsigned: false,
        canPartial: false,
        canBroadcast: false,
        isRelease: false,
        requiresDualSettle: true,
        userId: "github:1",
      },
    );
    expect(html).toContain('data-kh-settle-primary="1"');
    const detailsAt = html.indexOf('<details class="next-card-more">');
    expect(html.indexOf('id="kh-txid"')).toBeLessThan(detailsAt);
    expect(html).toContain('id="kh-confirm"');
    expect(html).toContain("Confirm settle");
  });

  it("release keeps settle under Other settle tools (PSBT primary)", () => {
    const html = keyholderDeskHtml(
      {
        kind: "release",
        proposal_id: "p1",
        state: "ready",
        outputs: [{ address: "tb1qout", amount_sats: 50_000, label: "builder" }],
        required_threshold: 3,
        partials: [],
      },
      {
        needsLn: false,
        canPsbt: true,
        canUnsigned: false,
        canPartial: true,
        canBroadcast: false,
        isRelease: true,
        requiresDualSettle: true,
        userId: "github:1",
      },
    );
    expect(html).not.toContain('data-kh-settle-primary="1"');
    expect(html).toContain("<summary>Other settle tools</summary>");
    const detailsAt = html.indexOf('<details class="next-card-more">');
    expect(html.indexOf('id="kh-txid"')).toBeGreaterThan(detailsAt);
    expect(html.indexOf('id="kh-propose"')).toBeGreaterThan(detailsAt);
  });

  it("keeps outputs, verify, and sign markup on the console", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "keyholders-page.ts"),
      "utf8",
    );
    expect(src).toContain('id="kh-sign"');
    expect(src).toContain('id="kh-verify-panel"');
    expect(src).toContain("kh-verify-outputs");
    expect(src).toContain("kh-outputs");
    expect(src).toContain('data-kh-tab="branch"');
    expect(src).toContain("kh-desk-queues");
    expect(src).toContain("keyholderQueueEmptyHtml");
    expect(src).toContain("kh-roster-row");
    expect(src).toContain('id="kh-revoke-modal"');
    expect(src).toContain("kh-branch-sign");
    expect(src).toContain('id="kh-detail-modal"');
    expect(src).toContain("data-kh-detail-close");
    expect(src).toContain("showDetailModal");
    expect(src).toContain("document.body.appendChild(detailModal)");
  });

  it("splits the roster into co-attest and revoke actions", () => {
    const html = keyholderRosterHtml(
      [
        { user_id: "github:me", github: "me", status: "active", fingerprint: "11223344" },
        { user_id: "github:alice", github: "alice", status: "active", fingerprint: "99AABBCC" },
        {
          user_id: "github:bob",
          github: "bob",
          status: "active",
          fingerprint: "DDEEFF00",
          pending_revoke: true,
          revoke_attest_count: 1,
          revoke_reason: "Missed two signing windows.",
          revoke_attested_by_me: false,
          revoke_attested_by: ["alice"],
        },
        { user_id: "github:new", github: "new", status: "invited", fingerprint: "AABBCCDD" },
      ],
      "github:me",
    );
    expect(html).toContain("Waiting to sit");
    expect(html).toContain("Sitting");
    expect(html).toContain(">You<");
    expect(html).toContain('data-kh-revoke="github:alice"');
    expect(html).toContain(">Revoke<");
    expect(html).toContain("1 of 2");
    expect(html).toContain(">Confirm<");
    expect(html).toContain('data-coattest="github:new"');
    expect(html).not.toContain('data-kh-revoke="github:me"');
    expect(html).toContain("does not change the Sparrow descriptor");
    expect(html).toContain("tab=keyholders");
    expect(html).toContain("Confirmed by @alice");
    expect(html).not.toContain("Bond refunds (0)");
  });

  it("hash-gates Upload signature until signed partial is non-empty", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "keyholders-page.ts"),
      "utf8",
    );
    // Branch desk: #kh-branch-sign requires #kh-branch-partial
    expect(src).toContain('alsoRequire: detailEl.querySelector<HTMLTextAreaElement>("#kh-branch-partial")');
    // Settle desk: #kh-sign requires #kh-psbt-partial
    expect(src).toContain('alsoRequire: detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-partial")');
    expect(src).toContain('alsoRequireEmptyReason: "Paste a signed partial to enable"');
  });

  it("branch desk hash-gates sign and does not offer broadcast", () => {
    const html = branchSignDeskHtml({
      proposal_id: "p1",
      allocation_id: "bounty",
      kind: "clean",
      published_sha256: "aa".repeat(32),
      signed: 0,
      required_threshold: 2,
      state: "open",
      decode: {
        outputs: [{ address: "tb1qout", amount_sats: 50_000, label: "builder" }],
      },
    });
    expect(html).toContain("kh-branch-verify");
    expect(html).toContain("kh-branch-sign");
    expect(html).toContain("kh-branch-txid");
    expect(html).toContain("Propose settle");
    expect(html).toContain("does not broadcast");
    expect(html).toContain("Settle txid (64 hex) — not a PSBT");
    expect(html).toContain("Needs 0/2 cosignatures");
    expect(html).toContain("off-desk Sparrow");
    expect(html).toContain("not a settle txid");
    expect(html).not.toContain(">Broadcast<");
    expect(html).not.toContain("cHNidP8");
  });

  it("enables Propose settle while open even if cosign threshold unmet (off-desk)", () => {
    const waiting01 = branchSignDeskHtml({
      proposal_id: "PLEBLY-2026-007",
      allocation_id: "reserve",
      kind: "clean",
      published_sha256: "aa".repeat(32),
      signed: 0,
      required_threshold: 1,
      state: "open",
      decode: {
        outputs: [{ address: "tb1qout", amount_sats: 10_000, label: "reserve" }],
      },
    });
    expect(waiting01).not.toMatch(/id="kh-branch-propose"\s+disabled\b/);
    expect(waiting01).toContain("Off-desk cosign OK");
    expect(waiting01).toMatch(
      /id="kh-branch-propose"[^>]*title="Off-desk cosign OK — after Sparrow broadcast, paste the confirmed 64-character settle txid \(API verifies\)"/,
    );
    expect(waiting01).toMatch(/id="kh-branch-confirm"\s+disabled\b/);

    const waiting03 = branchSignDeskHtml({
      proposal_id: "p1",
      allocation_id: "bounty",
      kind: "clean",
      published_sha256: "bb".repeat(32),
      signed: 0,
      required_threshold: 3,
      state: "open",
      decode: { outputs: [] },
    });
    expect(waiting03).not.toMatch(/id="kh-branch-propose"\s+disabled\b/);
    expect(waiting03).toContain("off-desk Sparrow broadcast");

    const ready = branchSignDeskHtml({
      proposal_id: "p1",
      allocation_id: "bounty",
      kind: "clean",
      published_sha256: "cc".repeat(32),
      signed: 2,
      required_threshold: 2,
      state: "threshold_met",
      decode: { outputs: [] },
    });
    expect(ready).toMatch(/id="kh-branch-propose"\s+title=/);
    expect(ready).not.toMatch(/id="kh-branch-propose"\s+disabled\b/);
    expect(ready).toContain(
      "After you broadcast in Sparrow, paste the 64-character settle txid",
    );
    expect(ready).toMatch(/id="kh-branch-confirm"\s+disabled\b/);

    const proposed = branchSignDeskHtml(
      {
        proposal_id: "p1",
        allocation_id: "bounty",
        kind: "clean",
        published_sha256: "dd".repeat(32),
        signed: 2,
        required_threshold: 2,
        state: "settle_proposed",
        settle_txid: "ab".repeat(32),
        settle_proposed_by: "github:1",
        decode: { outputs: [] },
      },
      { userId: "github:2" },
    );
    expect(proposed).toMatch(/id="kh-branch-propose"\s+disabled\b/);
    expect(proposed).toContain(
      "Settle already proposed — waiting for another keyholder to confirm",
    );
    expect(proposed).not.toMatch(/id="kh-branch-confirm"\s+disabled\b/);
  });

  it("settled chrome shows Settled + txid, not Needs 0/2 as primary", () => {
    const txid = "2f28600d643866e1cac40e7108497ae7deead552cf20a4b6aedfd533f3d4e309";
    const html = branchSignDeskHtml({
      proposal_id: "PLEBLY-2026-010",
      allocation_id: "bounty",
      kind: "clean",
      published_sha256: "aa".repeat(32),
      signed: 0,
      required_threshold: 2,
      state: "settled",
      settle_txid: txid,
      decode: { outputs: [] },
    });
    expect(html).toContain("Settled");
    expect(html).toContain(txid);
    expect(html).toMatch(/lifecycle-k">Settled</);
    expect(html).not.toContain("Needs 0/2 cosignatures");
    expect(html).not.toContain("kh-branch-propose");
    expect(branchSignChipLabel({
      state: "settled",
      signed: 0,
      required_threshold: 2,
      settle_txid: txid,
    })).toBe(`Settled · ${shortSettleTxid(txid)}`);
  });

  it("N-of-M next action names signers and off-desk settle path", () => {
    const next = branchSignNextAction(
      {
        state: "open",
        signed: 1,
        required_threshold: 2,
        published_sha256: "aa".repeat(32),
        partials: [{ keyholder_id: "github:1", fingerprint: "5c4993d8" }],
      },
      { signerNames: { "github:1": "josh" } },
    );
    expect(next).toContain("5c4993d8");
    expect(next).toContain("@josh");
    expect(next).toContain("Needs 1 more cosignature");
    expect(next).toContain("off-desk Sparrow broadcast");
    expect(
      branchSignNextAction({
        state: "threshold_met",
        signed: 2,
        required_threshold: 2,
      }),
    ).toContain("Ready to broadcast");
  });

  it("join sheet is public Signet 2-of-3 materials only", () => {
    expect(SIGNET_23_JOIN_SHEET).toContain("5c4993d8");
    expect(SIGNET_23_JOIN_SHEET).toContain("d9ae90f0");
    expect(SIGNET_23_JOIN_SHEET).toContain("0623e747");
    expect(SIGNET_23_JOIN_SHEET).toContain("m/84'/1'/0'");
    expect(SIGNET_23_JOIN_SHEET).toContain("not BIP48");
    expect(SIGNET_23_JOIN_SHEET).toContain(
      "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx",
    );
    expect(SIGNET_23_JOIN_SHEET).toContain("wsh(sortedmulti(2,");
    expect(SIGNET_23_JOIN_SHEET.toLowerCase()).not.toMatch(/\bseed(s)?\b.*mnemonic|mnemonic.*\bseed/);
    expect(SIGNET_23_JOIN_SHEET).not.toMatch(/\bxprv|\btprv/i);
  });

  it("downloads the unsigned branch transaction without embedding it", () => {
    const secret = "cHNidP8FAKEUNSIGNED";
    const html = branchSignDeskHtml({
      proposal_id: "p1",
      allocation_id: "bounty",
      kind: "clean",
      published_sha256: "aa".repeat(32),
      psbt_base64: secret,
      signed: 0,
      required_threshold: 1,
      state: "open",
      decode: {
        outputs: [{ address: "tb1qout", amount_sats: 50_000, label: "builder" }],
      },
    });
    expect(html).toContain("Download unsigned transaction");
    expect(html).toContain("Copy unsigned base64");
    expect(html).toContain("kh-branch-copy");
    expect(html).toContain("One signature");
    expect(html).toContain(keyholderTxPurpose("clean"));
    expect(html).not.toContain(secret);
    expect(html).not.toContain("cHNidP8");
    expect(html).not.toMatch(/>\s*Broadcast\s*</);
  });

  it("names a multisig quorum and the signers", () => {
    const html = branchSignDeskHtml(
      {
        proposal_id: "p1",
        allocation_id: "bounty",
        kind: "clean",
        published_sha256: "aa".repeat(32),
        signed: 1,
        required_threshold: 3,
        state: "open",
        partials: [{ keyholder_id: "github:1", fingerprint: "AABBCCDD" }],
        decode: { outputs: [] },
      },
      { signerNames: { "github:1": "ada" } },
    );
    expect(html).toContain("Multisig");
    expect(html).toContain("1 of 3");
    expect(html).toContain("@ada");
    expect(signatureProgressLabel(1, 3)).toBe("Multisig · 1 of 3");
    expect(signatureProgressLabel(0, 1)).toBe("One signature");
  });

  it("cash-out card names the destination and hides the transaction bytes", () => {
    const html = cashoutDeskHtml({
      amount_sats: 20_000,
      payout_address: "tb1qpay",
    });
    expect(html).toContain(keyholderTxPurpose("cashout"));
    expect(html).toContain("tb1qpay");
    expect(html).toContain("Download unsigned transaction");
    expect(html).toContain("kh-cashout-settle");
    expect(html).toContain("Settle txid (64 hex) — not a PSBT");
    expect(html).not.toContain("cHNidP8");
  });

  it("fills the receive address from Account and saves it from this step", () => {
    const payout = "tb1q" + "p".repeat(30);
    const seat = "tb1q" + "a".repeat(30);
    expect(keyholderReceiveAddress(seat, payout)).toBe(seat);
    expect(keyholderReceiveAddress("", payout)).toBe(payout);
    expect(keyholderReceiveAddress(seat, "satoshi@example.com")).toBe(seat);
    const html = keyholderProofWizardHtml(seat, payout);
    expect(html).toContain("Step 1 of 3");
    expect(html).toContain("stores it on your Account");
    expect(html).toContain(`value="${seat}"`);
    expect(html).toContain('id="kh-challenge-msg"');
    expect(html).not.toContain("Get a message to sign");
    expect(html).toContain("kh-wizard-save-addr");
    expect(html).not.toContain("do not enter one here");
    expect(html).not.toContain("Registered address");
    const empty = keyholderProofWizardHtml("  ");
    expect(empty).toContain('id="kh-auth-addr"');
    expect(empty).toContain("Save and continue");
    expect(
      keyholderSessionStale(
        "re-login required for keyholder actions (session older than 12h)",
      ),
    ).toBe(true);
    expect(keyholderSessionStale("unauthorized")).toBe(false);
  });

  it("keeps a bond-refund settle txid across re-login", () => {
    const mem = new Map<string, string>();
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size;
      },
    } as Storage;
    const txid = "ab".repeat(32);
    saveSettleDraft({ proposalId: "prop-1", disburseId: "d1", txid }, store);
    expect(readSettleDraft("prop-1", store)).toEqual({
      proposalId: "prop-1",
      disburseId: "d1",
      txid,
    });
    expect(readSettleDraft("prop-2", store)).toBeNull();
    clearSettleDraft("prop-1", store);
    expect(readSettleDraft("prop-1", store)).toBeNull();
  });

  it("asks for re-login inside the warn window and not on a fresh login", () => {
    const header = btoa(JSON.stringify({ alg: "none" })).replace(/=+$/, "");
    const fresh = `${header}.${btoa(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).replace(/=+$/, "")}.sig`;
    const near = `${header}.${btoa(
      JSON.stringify({
        iat: Math.floor(
          (Date.now() - (KEYHOLDER_SESSION_MAX_AGE_MS - KEYHOLDER_REAUTH_WARN_MS) - 2_000) / 1000,
        ),
      }),
    ).replace(/=+$/, "")}.sig`;
    expect(keyholderSessionNeedsReauth(fresh)).toBe(false);
    expect(keyholderSessionNeedsReauth(near)).toBe(true);
    expect(keyholderSessionNeedsReauth(null)).toBe(false);
    expect(receiveAddressUnchanged("tb1qabc", "tb1qabc")).toBe(true);
    expect(receiveAddressUnchanged("TB1QABC", "tb1qabc")).toBe(true);
    expect(receiveAddressUnchanged("tb1qchanged", "tb1qabc")).toBe(false);
    expect(receiveAddressUnchanged("tb1qabc", "")).toBe(false);
    expect(
      parseKeyholderReturnState(
        JSON.stringify({
          step: "address",
          address: "tb1qtyped",
          tab: "branch",
          wizardOpen: true,
          branch: { proposalId: "p1", allocationId: "bounty" },
        }),
      ),
    ).toEqual({
      step: "address",
      address: "tb1qtyped",
      tab: "branch",
      wizardOpen: true,
      branch: { proposalId: "p1", allocationId: "bounty" },
      disburseId: undefined,
    });
    expect(parseKeyholderReturnState("{")).toBeNull();
  });
});

describe("keyholder onboarding", () => {
  it("steps signed-out through apply to active", () => {
    expect(keyholderOnboardPhase({ signedIn: false, canApply: false })).toBe(
      "sign_in",
    );
    expect(
      keyholderOnboardPhase({ signedIn: true, canApply: false }),
    ).toBe("earn_reviewer");
    expect(
      keyholderOnboardPhase({ signedIn: true, canApply: true }),
    ).toBe("apply");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: true,
        application: { status: "pending" },
      }),
    ).toBe("election");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: false,
        keyholder: { status: "invited" },
      }),
    ).toBe("submit_keys");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: false,
        keyholder: { status: "pending_attest", attest_count: 1 },
      }),
    ).toBe("await_attest");
    expect(
      keyholderOnboardPhase({
        signedIn: true,
        canApply: true,
        keyholder: { status: "active" },
      }),
    ).toBe("active");
    expect(keyholderOnboardStepIndex("election")).toBe(2);
    expect(keyholderOnboardStepIndex("submit_keys")).toBe(3);
  });

  it("renders the current action only — no genesis, no seed", () => {
    const signedOut = keyholderOnboardHtml({
      signedIn: false,
      canApply: false,
    });
    expect(signedOut).toContain("Sign in to continue");
    expect(signedOut).toContain("is-current");
    expect(keyholderOnboardLede("sign_in")).toMatch(/Sign in/);

    const apply = keyholderOnboardHtml({ signedIn: true, canApply: true });
    expect(apply).toContain("kh-apply-form");
    expect(keyholderOnboardLede("submit_keys")).toContain(
      "does not update the Sparrow descriptor",
    );

    const keys = keyholderOnboardHtml({
      signedIn: true,
      canApply: false,
      keyholder: { status: "invited" },
    });
    expect(keys).toContain("kh-fp");
    expect(keys).toContain("Never paste a seed");
    expect(keys).not.toContain("genesis");
    expect(keys).not.toContain("HOOK_SECRET");

    const wait = keyholderOnboardHtml({
      signedIn: true,
      canApply: false,
      keyholder: {
        status: "pending_attest",
        fingerprint: "AABBCCDD",
        attest_count: 1,
      },
    });
    expect(wait).toContain("1/2");
    expect(wait).toContain("AABBCCDD");

    const form = keyholderKeysFormHtml({
      fingerprint: "11223344",
      xpub: "tpub1",
      heading: "Your keys",
    });
    expect(form).toContain("does not change the Sparrow descriptor");
    expect(form).not.toContain("mnemonic");
  });

  it("tells an empty roster that ops seats the first two", () => {
    expect(keyholderColdStart(0)).toBe(true);
    expect(keyholderColdStart(1)).toBe(true);
    expect(keyholderColdStart(2)).toBe(false);
    const empty = keyholderOnboardHtml({
      signedIn: false,
      canApply: false,
      activeSeats: 0,
    });
    expect(empty).toContain("First seats");
    expect(empty).toContain("Ops activates the first two together");
    expect(empty).not.toContain("genesis");
    expect(empty).not.toContain("HOOK_SECRET");
    expect(keyholderColdStartHtml(2)).toBe("");

    const stuck = keyholderOnboardHtml({
      signedIn: true,
      canApply: false,
      activeSeats: 0,
      keyholder: { status: "pending_attest", fingerprint: "AABBCCDD" },
    });
    expect(stuck).toContain("cannot start until two seats are already active");
  });
});

describe("keyholder settle page toast", () => {
  it("formats settled and waiting copy with optional txid prefix", () => {
    expect(settleToastTxidPrefix("")).toBe("");
    expect(settleToastTxidPrefix("not-hex")).toBe("");
    expect(settleToastTxidPrefix("abcdef01" + "aa".repeat(28))).toBe("abcdef01");
    expect(keyholderSettleToastText({ outcome: "settled" })).toBe("Settled.");
    expect(
      keyholderSettleToastText({
        outcome: "settled",
        txid: "deadbeef" + "11".repeat(28),
      }),
    ).toBe("Settled. · deadbeef…");
    expect(keyholderSettleToastText({ outcome: "proposed_waiting" })).toBe(
      "Settle proposed — waiting for second keyholder",
    );
    expect(
      keyholderSettleToastText({
        outcome: "proposed_waiting",
        txid: "cafebabe" + "22".repeat(28),
      }),
    ).toBe("Settle proposed — waiting for second keyholder · cafebabe…");
  });

  it("renders a page-level aria-live toast outside the detail modal", () => {
    const html = keyholderPageToastHtml("Settled. · deadbeef…");
    expect(html).toContain('id="kh-page-toast"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("lifecycle-banner");
    expect(html).toContain("kh-page-toast");
    expect(html).toContain("Settled. · deadbeef…");
    expect(html).toContain('data-kh-toast-dismiss');
    expect(html).toContain("Dismiss");
    // Escapes untrusted copy
    const escaped = keyholderPageToastHtml('<img src=x onerror=alert(1)>');
    expect(escaped).not.toContain("<img");
    expect(escaped).toContain("&lt;img");
  });
});

