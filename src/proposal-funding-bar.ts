import { isDirectProposal, isOpenToClaim, isTakenStatus } from "./builder";
import type { Proposal, ProposalMilestone } from "./types";
import { escapeHtml, formatSats } from "./util";

/**
 * Compact meter for cards/lists.
 * Scale = max(floor, target) so claim floor is never shown as the funding ceiling
 * when a soft target exists. Green to floor; tertiary toward target; orange past scale.
 */
export function fundingBarTrackHtml(
  funded: number,
  floor: number,
  variant: "progress" | "proposal-progress" = "proposal-progress",
  target: number | null = null,
): string {
  const safeFloor = Math.max(1, floor);
  const targetSats =
    target != null && Number.isFinite(target) && target > 0
      ? Math.floor(target)
      : 0;
  const scale = Math.max(safeFloor, targetSats || safeFloor);
  const fillPct = Math.min(100, (Math.max(0, funded) / scale) * 100);
  const floorPct = Math.min(100, (safeFloor / scale) * 100);

  if (funded <= safeFloor || scale <= safeFloor) {
    return `<div class="${variant}" role="progressbar" aria-valuemin="0" aria-valuemax="${scale}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${fillPct}%"></span></div>`;
  }
  if (funded <= scale) {
    const greenPct = Math.min(fillPct, floorPct);
    const restPct = Math.max(0, fillPct - greenPct);
    return `<div class="${variant}" role="progressbar" aria-valuemin="0" aria-valuemax="${scale}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${greenPct}%"></span>${
      restPct > 0
        ? `<span class="progress-toward-target" style="width:${restPct}%"></span>`
        : ""
    }</div>`;
  }
  const greenPct = Math.max(0.5, (safeFloor / funded) * 100);
  const orangePct = Math.max(0, 100 - greenPct);
  return `<div class="${variant} is-overfunded" role="progressbar" aria-valuemin="0" aria-valuemax="${Math.round(funded)}" aria-valuenow="${Math.round(funded)}"><span class="progress-floor" style="width:${greenPct}%"></span><span class="progress-over" style="width:${orangePct}%"></span></div>`;
}

export type FundingBarMarker = {
  sats: number;
  kind: "floor" | "threshold";
  id?: string;
  label?: string;
};

/** Scale + markers for detail funding bar (claim floor always; optional thresholds). */
export function fundingBarScale(
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
): { scale: number; markers: FundingBarMarker[] } {
  const safeFloor = Math.max(1, floor);
  const thresholds: { sats: number; id?: string; label?: string }[] = [];
  for (const m of milestones) {
    const sats = m.funding_threshold_sats;
    if (typeof sats === "number" && Number.isFinite(sats) && sats >= 1) {
      thresholds.push({
        sats,
        id: m.id,
        label: m.id || undefined,
      });
    }
  }
  const highest = thresholds.reduce((m, t) => Math.max(m, t.sats), 0);
  const targetSats =
    target != null && Number.isFinite(target) && target > 0
      ? Math.floor(target)
      : 0;
  const scale = Math.max(safeFloor, targetSats || safeFloor, highest);
  const markers: FundingBarMarker[] = [
    { sats: safeFloor, kind: "floor", label: "Opens" },
  ];
  for (const t of thresholds) {
    markers.push({
      sats: Math.floor(t.sats),
      kind: "threshold",
      id: t.id,
      label: t.label,
    });
  }
  markers.sort((a, b) => a.sats - b.sats);
  return { scale, markers };
}

function fundingDetailTrackHtml(
  funded: number,
  floor: number,
  scale: number,
  markers: FundingBarMarker[],
  /** When false, claimed/closed listings avoid "Opens for builders" / open-floor wording. */
  openCopy = true,
): string {
  const safeScale = Math.max(1, scale);
  const fillPct = Math.min(100, (funded / safeScale) * 100);
  const overTarget = funded > safeScale;
  const showLocks = markers.some((m) => m.kind === "threshold");
  const ticks = markers
    .map((m) => {
      const left = Math.min(100, Math.max(0, (m.sats / safeScale) * 100));
      const unlocked = funded >= m.sats;
      const lock =
        showLocks && m.kind === "threshold"
          ? unlocked
            ? ""
            : `<span class="funding-marker-lock" aria-hidden="true"></span>`
          : "";
      const state = unlocked ? "is-unlocked" : "is-locked";
      const kind = m.kind === "floor" ? "floor" : "threshold";
      const label =
        m.kind === "floor"
          ? openCopy
            ? `Opens for builders at ${m.sats.toLocaleString()} sats, ${unlocked ? "reached" : "not yet"}`
            : `Claim floor ${m.sats.toLocaleString()} sats, ${unlocked ? "reached" : "not yet"}`
          : `Milestone ${m.label || m.id || ""} ${m.sats.toLocaleString()} sats, ${unlocked ? "unlocked" : "locked"}`;
      return `<span class="funding-marker funding-marker-${kind} ${state}" style="left:${left}%" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${lock}<span class="funding-marker-tick"></span></span>`;
    })
    .join("");
  const overClass = overTarget ? " is-overfunded" : "";
  const floorPct = Math.min(100, (Math.max(1, floor) / safeScale) * 100);
  let fillHtml: string;
  if (funded <= Math.max(1, floor) || floor >= safeScale) {
    fillHtml = `<span class="progress-floor" style="width:${fillPct}%"></span>`;
  } else if (funded <= safeScale) {
    const greenPct = Math.min(fillPct, floorPct);
    const restPct = Math.max(0, fillPct - greenPct);
    fillHtml = `<span class="progress-floor" style="width:${greenPct}%"></span>${
      restPct > 0
        ? `<span class="progress-toward-target" style="width:${restPct}%"></span>`
        : ""
    }`;
  } else {
    const greenPct = Math.max(0.5, (Math.max(1, floor) / funded) * 100);
    const orangePct = Math.max(0, 100 - greenPct);
    fillHtml = `<span class="progress-floor" style="width:${greenPct}%"></span><span class="progress-over" style="width:${orangePct}%"></span>`;
  }
  return `<div class="proposal-progress proposal-progress-detail${overClass}" role="progressbar" aria-valuemin="0" aria-valuemax="${safeScale}" aria-valuenow="${Math.round(funded)}">
      <div class="proposal-progress-fill">${fillHtml}</div>
      <div class="funding-markers">${ticks}</div>
    </div>`;
}

/** Soft target only — claim floor is a minimum to start work, never a funding ceiling. */
export function fundingTargetSats(target: number | null | undefined): number | null {
  if (target != null && Number.isFinite(target) && target > 0) {
    return Math.floor(target);
  }
  return null;
}

/** True only when funded past the soft target (not merely past the claim floor). */
export function isPastFundingTarget(
  funded: number,
  target: number | null | undefined,
): boolean {
  const t = fundingTargetSats(target);
  return t != null && funded > t;
}

export function overfundRatioLabel(funded: number, target: number): string {
  const ratio = funded / Math.max(1, target);
  if (ratio < 1.05) return "";
  const pretty =
    ratio >= 100
      ? `${Math.round(ratio)}×`
      : ratio >= 10
        ? `${ratio.toFixed(0)}×`
        : `${ratio.toFixed(1)}×`;
  return `${pretty} target`;
}

/** Optional lifecycle fields so the meter does not say Open to apply when awarded. */
export type FundingProgressContext = {
  status?: string | null;
  claimer?: string | null;
  proposal_type?: string | null;
};

function fundingClosedLabel(status: string): string {
  const s = String(status || "").toLowerCase();
  if (s === "claimed") return "Claimed";
  if (s === "in_review") return "In review";
  if (s === "rejected") return "Rejected";
  if (s === "completed") return "Completed";
  return "Applications closed";
}

export function fundingProgressHtml(
  balance: number | undefined,
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
  ctx: FundingProgressContext = {},
): string {
  const funded = balance ?? 0;
  const { scale, markers } = fundingBarScale(floor, target, milestones);
  const pastFloor = funded >= floor;
  const eligibility = {
    status: ctx.status ?? "claimable",
    claimer: ctx.claimer ?? null,
    balance_sats: funded,
    proposal_type: ctx.proposal_type ?? "bounty",
  } as Proposal;
  const open = isOpenToClaim(eligibility, floor);
  const taken =
    isTakenStatus(String(eligibility.status)) || Boolean(eligibility.claimer);
  const targetSats = fundingTargetSats(target);
  const over = isPastFundingTarget(funded, targetSats);
  const remaining = Math.max(0, floor - funded);
  const overLabel = over && targetSats ? overfundRatioLabel(funded, targetSats) : "";
  const hasTarget = targetSats != null;
  const floorPct = Math.min(
    999,
    Math.round((funded / Math.max(1, floor)) * 100),
  );
  const targetPct = hasTarget
    ? Math.min(999, Math.round((funded / Math.max(1, targetSats!)) * 100))
    : floorPct;
  const label = over
    ? `Overfunded${overLabel ? ` · ${overLabel}` : ""}`
    : open
      ? "Open to apply"
      : taken
        ? fundingClosedLabel(String(eligibility.status))
        : pastFloor
          ? isDirectProposal(eligibility)
            ? "Receiving"
            : "Applications closed"
          : `${formatSats(remaining)} to open`;
  const labelClass = over
    ? " overfunded"
    : open
      ? " claimable"
      : "";
  // Always name the claim floor — never let target_sats look like the floor.
  // Only say "to open" while still funding toward / open for apply; claimed etc. use "floor".
  const openCopy = !taken && (open || !pastFloor);
  const floorWord = openCopy ? "to open" : "floor";
  const goalLine = hasTarget
    ? `${formatSats(funded)} / ${formatSats(floor)} ${floorWord} (${floorPct}%) · goal ${formatSats(target!)} (${targetPct}%)`
    : `${formatSats(funded)} / ${formatSats(floor)} ${floorWord} · ${floorPct}%`;
  return `<div class="funding-meter" data-funding-scale="${scale}">
      <div class="funding-meter-top">
        <span class="funding-meter-label${labelClass}">${label}</span>
        <span class="funding-meter-goal sats">${goalLine}</span>
      </div>
      ${fundingDetailTrackHtml(funded, floor, scale, markers, openCopy)}
    </div>`;
}

/** Slim funding strip under the hero: progress only, no duplicate stat cards. */
export function proposalFundingBarHtml(
  balance: number | undefined,
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
  ctx: FundingProgressContext = {},
): string {
  return `<div class="proposal-funding-bar" data-milestones="${milestones.length}">
    ${fundingProgressHtml(balance, floor, target, milestones, ctx)}
  </div>`;
}

/** Replace the live funding bar when confirmed balance changes. */
export function updateProposalFundingBar(
  root: ParentNode,
  balance: number,
  floor: number,
  target: number | null,
  milestones: ProposalMilestone[] = [],
  ctx: FundingProgressContext = {},
): void {
  const host = root.querySelector(".proposal-funding-bar");
  if (!host) return;
  const prevUnlocked = new Set(
    [...host.querySelectorAll(".funding-marker.is-unlocked")].map(
      (el) => (el as HTMLElement).style.left,
    ),
  );
  host.innerHTML = fundingProgressHtml(balance, floor, target, milestones, ctx);
  for (const el of host.querySelectorAll(".funding-marker.is-unlocked")) {
    const left = (el as HTMLElement).style.left;
    if (!prevUnlocked.has(left) && el.classList.contains("funding-marker-threshold")) {
      el.classList.add("funding-marker-pulse");
    }
  }
}
