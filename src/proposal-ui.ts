import { BITCOIN_NETWORK } from "./config";
import type { Proposal, ProposalMilestone } from "./types";
import { escapeHtml, formatSats } from "./util";

const MEMPOOL_WEB =
  BITCOIN_NETWORK === "signet"
    ? "https://mempool.space/signet"
    : "https://mempool.space";

export function formatProposalDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function statusClass(status: string): string {
  if (["listed", "claimable", "completed"].includes(status)) return "status-good";
  if (["claimed", "in_review", "funding"].includes(status)) return "status-active";
  if (["declined", "rejected", "underfunded"].includes(status)) return "status-bad";
  return "status-neutral";
}

export function fundingProgressHtml(
  balance: number | undefined,
  floor: number,
  target: number | null,
): string {
  const funded = balance ?? 0;
  const goal = target && target > floor ? target : floor;
  const pct = Math.min(100, Math.round((funded / goal) * 100));
  const claimable = funded >= floor;
  return `<div class="funding-meter">
      <div class="funding-meter-top">
        <span class="funding-meter-label">${claimable ? "Claimable" : `${pct}% funded`}</span>
        <span class="funding-meter-goal sats">${formatSats(funded)} / ${formatSats(goal)}</span>
      </div>
      <div class="proposal-progress"><span style="width:${pct}%"></span></div>
    </div>`;
}

function copyBtn(value: string, label: string): string {
  return `<button type="button" class="copy-btn" data-copy="${escapeHtml(value)}" title="Copy ${escapeHtml(label)}">Copy</button>`;
}

function explorerLink(href: string, label: string): string {
  return `<a class="explorer-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`;
}

export function onChainPanelHtml(p: Proposal): string {
  const rows: string[] = [];

  if (p.escrow_address) {
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Escrow address</span>
      <div class="onchain-value">
        <code class="mono">${escapeHtml(p.escrow_address)}</code>
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/address/${encodeURIComponent(p.escrow_address)}`, "Explorer")}
          ${copyBtn(p.escrow_address, "address")}
        </span>
      </div>
    </div>`);
  }

  if (p.submission_fee_txid) {
    const tx = p.submission_fee_txid;
    const short = `${tx.slice(0, 8)}…${tx.slice(-8)}`;
    rows.push(`<div class="onchain-row">
      <span class="onchain-label">Submission fee</span>
      <div class="onchain-value">
        <code class="mono" title="${escapeHtml(tx)}">${escapeHtml(short)}</code>
        <span class="onchain-actions">
          ${explorerLink(`${MEMPOOL_WEB}/tx/${tx}`, "Explorer")}
          ${copyBtn(tx, "txid")}
        </span>
      </div>
    </div>`);
  }

  if (p.escrow_index != null) {
    rows.push(`<div class="onchain-row onchain-row-inline">
      <span class="onchain-label">Escrow index</span>
      <span class="onchain-inline-value">${escapeHtml(String(p.escrow_index))}</span>
    </div>`);
  }

  if (!rows.length) return "";
  return `<div class="onchain-panel">${rows.join("")}</div>`;
}

export function metaChipsHtml(p: Proposal): string {
  const chips: string[] = [];
  if (p.id) {
    chips.push(`<span class="meta-chip"><span class="meta-chip-k">ID</span>${escapeHtml(p.id)}</span>`);
  }
  const created = formatProposalDate(p.created_at);
  if (created) {
    chips.push(`<span class="meta-chip"><span class="meta-chip-k">Created</span>${escapeHtml(created)}</span>`);
  }
  if (!chips.length) return "";
  return `<div class="meta-chips">${chips.join("")}</div>`;
}

export function milestonesHtml(milestones: ProposalMilestone[]): string {
  if (!milestones.length) return "";
  return `<div class="milestones">
    <h3 class="milestones-title">Milestones</h3>
    <div class="milestone-list">${milestones
      .map(
        (m, i) => `<article class="milestone-card">
          <div class="milestone-head">
            <span class="milestone-num">${i + 1}</span>
            <span class="milestone-sats sats">${formatSats(m.allocation_sats)}</span>
          </div>
          <p class="milestone-deadline">${escapeHtml(m.deadline)}</p>
          <p class="milestone-text">${escapeHtml(m.deliverable)}</p>
        </article>`,
      )
      .join("")}</div>
  </div>`;
}

function verificationStepsHtml(body: string): string | null {
  const items = body
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s+/.test(l))
    .map((l) => l.replace(/^\d+\.\s+/, "").trim());
  if (items.length < 2) return null;
  return `<ol class="verify-steps">${items
    .map((item) => `<li>${linkifyInline(item)}</li>`)
    .join("")}</ol>`;
}

function linkifyInline(text: string): string {
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer noopener">$1</a>',
  );
}

export function sectionBodyHtml(title: string, body: string, renderMd: (s: string) => string): string {
  const key = title.toLowerCase();
  if (key === "verification") {
    const steps = verificationStepsHtml(body);
    if (steps) return steps;
  }
  return `<div class="prose-rich">${renderMd(body)}</div>`;
}

export function bindProposalCopyButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const value = btn.dataset.copy;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        const prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = prev;
        }, 1200);
      } catch {
        /* ignore */
      }
    });
  });
}
