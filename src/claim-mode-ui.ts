/**
 * Shared claim-mode chips / relative timers for home cards, proposal hero, builder panel.
 */
import { isOpenToClaim } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import type { Proposal } from "./types";
import { escapeHtml } from "./util";

export function relativeTimeLeft(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "";
  const ms = Date.parse(iso) - nowMs;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "ending soon";
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return `${Math.max(1, h)}h left`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h left`;
}

/** Short chip label for catalogs (“Picks in 4d” / “Auto in 4d”). */
export function deadlineChipLabel(
  endsAt: string | null | undefined,
  kind: "picks" | "auto",
  nowMs = Date.now(),
): string {
  const verb = kind === "auto" ? "Auto" : "Picks";
  if (!endsAt) return kind === "auto" ? "Auto soon" : "Open to apply";
  const ms = Date.parse(endsAt) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) return `${verb} soon`;
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${verb} in ${Math.max(1, h)}h`;
  const d = Math.ceil(h / 24);
  return `${verb} in ${d}d`;
}

export function picksInChipLabel(
  endsAt: string | null | undefined,
  nowMs = Date.now(),
): string {
  return deadlineChipLabel(endsAt, "picks", nowMs);
}

export type ClaimModeChipInput = Pick<
  Proposal,
  | "proposal_type"
  | "status"
  | "claimer"
  | "balance_sats"
  | "claim_mode"
  | "claim_apps_total"
  | "claim_apps_bonded"
  | "claim_phase"
  | "claim_window_ends_at"
  | "claim_decision_ends_at"
>;

type ChipPayload = {
  label: string;
  title: string;
  endsAt?: string | null;
  chipKind?: "picks" | "auto" | "static";
  bonded?: number;
};

function chipPayload(
  p: ClaimModeChipInput,
  floor = CLAIM_FLOOR_SATS,
  nowMs = Date.now(),
): ChipPayload | null {
  if (String(p.proposal_type || "bounty").toLowerCase() === "direct") return null;
  if (!isOpenToClaim(p as Proposal, floor)) return null;

  const mode = String(p.claim_mode || "proposer_select");
  if (mode === "first_bonded") {
    return {
      label: "First bonded",
      title: "First builder who pays the claim bond wins",
      chipKind: "static",
    };
  }

  const bonded =
    typeof p.claim_apps_bonded === "number" ? p.claim_apps_bonded : null;
  const total =
    typeof p.claim_apps_total === "number" ? p.claim_apps_total : null;
  const phase = String(p.claim_phase || "");

  if (phase === "grace" && p.claim_decision_ends_at) {
    const left = deadlineChipLabel(p.claim_decision_ends_at, "auto", nowMs);
    const n =
      bonded != null && bonded > 0 ? `${bonded} bonded · ${left}` : left;
    return {
      label: n,
      title: "Decision grace — auto-awards earliest bond if no pick",
      endsAt: p.claim_decision_ends_at,
      chipKind: "auto",
      bonded: bonded ?? 0,
    };
  }

  if (bonded != null && bonded > 0) {
    const picks = deadlineChipLabel(p.claim_window_ends_at, "picks", nowMs);
    const label =
      bonded === 1 ? `1 applying · ${picks}` : `${bonded} applying · ${picks}`;
    return {
      label,
      title: "Builders applied with bond; proposer picks",
      endsAt: p.claim_window_ends_at,
      chipKind: "picks",
      bonded,
    };
  }

  if (total != null && total > 0) {
    return {
      label: `${total} awaiting bond`,
      title: "Applications awaiting bond",
      chipKind: "static",
    };
  }

  if (p.claim_window_ends_at) {
    return {
      label: deadlineChipLabel(p.claim_window_ends_at, "picks", nowMs),
      title: "Builders apply with bond; proposer picks",
      endsAt: p.claim_window_ends_at,
      chipKind: "picks",
      bonded: 0,
    };
  }

  return {
    label: "Open to apply",
    title: "Builders apply with bond; proposer picks",
    chipKind: "static",
  };
}

function chipSpanHtml(
  payload: ChipPayload,
  className: string,
  id?: string,
): string {
  const data =
    payload.chipKind && payload.chipKind !== "static" && payload.endsAt
      ? ` data-claim-chip="${escapeHtml(payload.chipKind)}" data-claim-ends-at="${escapeHtml(payload.endsAt)}" data-claim-bonded="${payload.bonded ?? 0}"`
      : "";
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";
  return `<span class="${className}"${idAttr} title="${escapeHtml(payload.title)}"${data}>${escapeHtml(payload.label)}</span>`;
}

/**
 * Home / hero chip for open bounties.
 * Prefer live catalog enrich (app counts + window ends) when present.
 */
export function claimModeChipHtml(
  p: ClaimModeChipInput,
  floor = CLAIM_FLOOR_SATS,
  nowMs = Date.now(),
): string {
  const payload = chipPayload(p, floor, nowMs);
  if (!payload) return "";
  return chipSpanHtml(payload, "project-card-open claim-mode-chip");
}

/** Hero meta chip (same semantics, compact). */
export function claimModeHeroChipHtml(
  p: ClaimModeChipInput,
  floor = CLAIM_FLOOR_SATS,
  nowMs = Date.now(),
): string {
  const payload = chipPayload(p, floor, nowMs);
  if (!payload) return "";
  return chipSpanHtml(
    payload,
    "proposal-meta-chip proposal-claim-mode",
    "proposal-claim-mode-chip",
  );
}

/** Recompute relative chip labels from data-* (home + hero countdown tick). */
export function refreshClaimModeChips(
  root: ParentNode = document,
  nowMs = Date.now(),
): void {
  root.querySelectorAll<HTMLElement>("[data-claim-chip][data-claim-ends-at]").forEach(
    (el) => {
      const kind = el.dataset.claimChip === "auto" ? "auto" : "picks";
      const endsAt = el.dataset.claimEndsAt || "";
      const bonded = Number(el.dataset.claimBonded || 0);
      const left = deadlineChipLabel(endsAt, kind, nowMs);
      if (kind === "auto") {
        el.textContent =
          bonded > 0 ? `${bonded} bonded · ${left}` : left;
      } else if (bonded > 0) {
        el.textContent =
          bonded === 1 ? `1 applying · ${left}` : `${bonded} applying · ${left}`;
      } else {
        el.textContent = left;
      }
    },
  );
}

/** Relative deadline spans inside builder panel (`data-rel-deadline`). */
export function refreshRelDeadlines(
  root: ParentNode = document,
  nowMs = Date.now(),
): void {
  root.querySelectorAll<HTMLElement>("[data-rel-deadline]").forEach((el) => {
    const iso = el.dataset.relDeadline || "";
    const left = relativeTimeLeft(iso, nowMs);
    if (left) el.textContent = left;
  });
}
