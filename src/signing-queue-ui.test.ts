import { describe, expect, it } from "vitest";
import { disableSiblingOutpoints, signingCardHtml, signingQueueHtml } from "./signing-queue-ui";
import type { SigningCard } from "./signing-types";
import { descriptorToWalletPolicy } from "./signing-device";

function card(partial: Partial<SigningCard> & Pick<SigningCard, "card_id" | "outpoints" | "bucket">): SigningCard {
  return {
    source: "branch",
    proposal_id: "p",
    kind: "clean",
    title: partial.card_id,
    published_sha256: "aa",
    psbt_base64: "cHNidP8",
    outputs: [],
    signed: 0,
    required_threshold: 2,
    state: "open",
    awaiting_confirmation: false,
    in_sitting: partial.bucket !== "blocked",
    ...partial,
  };
}

describe("signing queue", () => {
  it("disables a second card that spends the same outpoint", () => {
    document.body.innerHTML = signingQueueHtml([
      card({ card_id: "a", bucket: "approved", outpoints: ["aa:0"] }),
      card({ card_id: "b", bucket: "approved", outpoints: ["aa:0"] }),
    ]);
    disableSiblingOutpoints(document.body, "a");
    const b = document.querySelector<HTMLButtonElement>('[data-open-card="b"]');
    const a = document.querySelector<HTMLButtonElement>('[data-open-card="a"]');
    expect(b?.disabled).toBe(true);
    expect(a?.disabled).toBe(false);
  });

  it("keeps a flagged card from signing until the flag is opened", () => {
    const html = signingCardHtml(
      card({
        card_id: "d",
        bucket: "flagged",
        kind: "disputed",
        outpoints: ["bb:1"],
        flag_text: "The deliverable was rejected.",
        outputs: [{ address: "tb1qexampleaddress000000000000000000000", amount_sats: 50_000, label: "builder" }],
      }),
    );
    expect(html).toContain("The deliverable was rejected.");
    expect(html).toMatch(/id="kh-sign-ledger"[^>]*disabled/);
    expect(html).toContain("tb1q");
    expect(html).toContain("Match this address on the device");
    expect(html).not.toContain("cHNidP8");
  });
});

describe("ledger policy", () => {
  it("turns a multisig descriptor into a wallet policy", () => {
    const descriptor =
      "wsh(sortedmulti(2,[5c4993d8/48h/1h/0h/2h]tpubD6NzVbkrYhZ4YgKm9Examp1ePubKeyMater1a1AAAA1111222233334445/<0;1>/*,[d9ae90f0/48h/1h/0h/2h]tpubD6NzVbkrYhZ4YgKm9Examp1ePubKeyMater1a1BBBB5555666677778889/<0;1>/*))";
    const policy = descriptorToWalletPolicy(descriptor);
    expect(policy.keys).toHaveLength(2);
    expect(policy.descriptorTemplate).toContain("@0/**");
    expect(policy.descriptorTemplate).toContain("@1/**");
    expect(policy.descriptorTemplate).not.toContain("tpub");
    expect(policy.name.length).toBeLessThanOrEqual(16);
  });
});
