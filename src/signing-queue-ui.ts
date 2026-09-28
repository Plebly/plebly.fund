import { formatSats, html } from "./util";
import type { SigningCard } from "./signing-types";

function purpose(kind: string): string {
  if (kind === "structure") return "Fund this bounty. The outputs are the work amounts plus the reviewer reserve.";
  if (kind === "clean") {
    return "Pay the builder, and send the keyholder and reviewer shares out of this escrow.";
  }
  if (kind === "refund" || kind === "timelock" || kind === "reserve_refund" || kind === "reserve_reviewers") {
    return kind === "reserve_reviewers" ? "Pay reviewers from the reserve." : "Return funds.";
  }
  if (kind === "disputed") return "Pay the disputed branch. Read the flag before signing.";
  if (kind === "release") return "Pay this month's lines, including the keyholder pool output.";
  return kind;
}

function matchOutput(card: SigningCard): { address: string; label?: string } | null {
  const preferred =
    card.outputs.find((o) => o.label === "builder") ||
    card.outputs.find((o) => o.label === "donor_pool") ||
    card.outputs[0];
  return preferred?.address ? preferred : null;
}

export function chunkAddress(address: string): string {
  const parts: string[] = [];
  for (let i = 0; i < address.length; i += 8) parts.push(address.slice(i, i + 8));
  return parts.join(" ");
}

export function signingQueueHtml(cards: SigningCard[]): string {
  const groups: { id: string; title: string; items: SigningCard[] }[] = [
    { id: "approved", title: "Approved", items: cards.filter((c) => c.bucket === "approved") },
    { id: "flagged", title: "Flagged", items: cards.filter((c) => c.bucket === "flagged") },
    { id: "blocked", title: "Blocked", items: cards.filter((c) => c.bucket === "blocked") },
  ];
  return html`<div class="kh-signing-queue">${groups
    .filter((g) => g.items.length)
    .map(
      (g) => html`<section class="kh-signing-group" data-bucket="${g.id}">
        <h3 class="proposal-block-title">${g.title}</h3>
        <ul class="declined-list">${g.items.map((card) => {
          const disabled = card.bucket === "blocked" ? "disabled" : "";
          return html`<li class="declined-row" data-card="${card.card_id}" data-outpoints="${card.outpoints.join(" ")}">
            <button type="button" class="declined-title btn ghost" data-open-card="${card.card_id}" ${disabled}>${card.title}</button>
            <p class="kh-queue-purpose">${purpose(card.kind)}</p>
            <span class="declined-meta">
              <span class="pill">${card.kind}</span>
              <span class="kh-sign-chip">${card.signed}/${card.required_threshold}</span>
              ${card.block_reason ? html`<span class="muted">${card.block_reason}</span>` : ""}
            </span>
          </li>`;
        })}</ul>
      </section>`,
    )}</div>`.value;
}

export function signingCardHtml(
  card: SigningCard,
  opts?: { busy?: "ledger" | "seed" },
): string {
  const rows = card.outputs.map(
    (o) =>
      html`<tr><td>${o.label || "—"}</td><td class="mono">${chunkAddress(o.address)}</td><td>${formatSats(o.amount_sats)}</td></tr>`,
  );
  const match = matchOutput(card);
  const ready = card.signed >= card.required_threshold && card.bucket !== "blocked";
  const flag =
    card.bucket === "flagged" && card.flag_text
      ? html`<details class="kh-flag"><summary>Flag</summary><p>${card.flag_text}</p></details>`
      : "";
  const broadcast = ready && !opts?.busy
    ? html`<p class="muted">Signatures are in. Broadcast is a separate step. It sends this transaction once.</p>
        <button type="button" class="btn" id="kh-sign-broadcast">${
          card.awaiting_confirmation ? "Check confirmation" : "Broadcast"
        }</button>`
    : "";
  const device = opts?.busy
    ? html`<p class="muted">${
        opts.busy === "seed"
          ? "Scan this QR with the SeedSigner. When the device shows a signed QR, scan it back here. The camera stays off until you ask."
          : "Confirm this transaction on the Ledger. Match the address above before you approve it."
      }</p>
      <canvas id="kh-seed-qr" ${opts.busy === "seed" ? "" : "hidden"}></canvas>
      <video id="kh-seed-video" hidden playsinline></video>
      <div class="comment-compose-actions">
        ${opts.busy === "seed" ? html`<button type="button" class="btn" id="kh-seed-scan">Scan the signed QR</button>` : ""}
        <button type="button" class="btn ghost" id="kh-sign-stop">Stop</button>
      </div>`
    : card.bucket === "blocked" || ready
      ? ""
      : html`<div class="comment-compose-actions">
          <button type="button" class="btn" id="kh-sign-ledger" ${card.bucket === "flagged" ? "disabled" : ""}>Sign with Ledger</button>
          <button type="button" class="btn ghost" id="kh-sign-seed" ${card.bucket === "flagged" ? "disabled" : ""}>Sign with SeedSigner</button>
        </div>
        <canvas id="kh-seed-qr" hidden></canvas>
        <video id="kh-seed-video" hidden playsinline></video>`;
  return html`<div class="form-panel form-panel-wide" data-signing-card="${card.card_id}">
    <h2 class="proposal-block-title" id="kh-detail-title" tabindex="-1">${card.kind} · ${card.title}</h2>
    <p class="next-card-sentence">${purpose(card.kind)}</p>
    <p class="muted">Fee estimate frozen at 10 sat/vB.</p>
    ${
      match
        ? html`<p class="kh-match-k">Match this address on the device</p>
            <p class="mono kh-match-address">${chunkAddress(match.address)}</p>`
        : ""
    }
    <p class="kh-verify-status" id="kh-verify-status" role="status">Checking outputs…</p>
    ${flag}
    <table class="kh-outputs">
      <caption class="sr-only">Outputs</caption>
      <thead><tr><th scope="col">Role</th><th scope="col">Address</th><th scope="col">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="kh-sign-chip">${card.signed} of ${card.required_threshold} signatures</p>
    ${device}
    ${broadcast}
    <p class="builder-msg" id="kh-sign-msg" hidden role="status"></p>
  </div>`.value;
}

export function disableSiblingOutpoints(root: ParentNode, selectedId: string): void {
  const rows = [...root.querySelectorAll<HTMLElement>("[data-card]")];
  const selected = rows.find((row) => row.dataset.card === selectedId);
  const mine = new Set((selected?.dataset.outpoints || "").split(" ").filter(Boolean));
  for (const row of rows) {
    const btn = row.querySelector("button");
    if (!btn || row.dataset.card === selectedId) continue;
    const ops = (row.dataset.outpoints || "").split(" ").filter(Boolean);
    const hit = ops.some((op) => mine.has(op));
    if (hit) btn.disabled = true;
  }
}
