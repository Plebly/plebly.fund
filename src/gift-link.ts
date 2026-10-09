/**
 * App-level gift linking: one /record retry run per gift (txid:vout), kept in
 * memory outside the Donate modal and the proposal view, so closing the modal
 * or navigating inside the app never kills it. Only stopGiftLinks() (page
 * unload) and a session change stop a run. Each gift gets one toast in a
 * single bottom region that never takes focus. No stored state.
 */
import { currentSessionToken } from "./auth";
import {
  claimContributionWithRetry,
  recordContributionWithRetry,
  RecordRetryCancelled,
  RECORD_PENDING_INDEX_COPY,
  RECORD_RETRY_STATUS_COPY,
} from "./funder-credit";
import { formatSats } from "./util";

/** #94's refusal / failure line, word for word (DONATE_LINK_REFUSED_COPY). */
export const GIFT_LINK_FAILED_COPY =
  "A new deposit was seen at this address, but this page couldn't link it to your account. If you sent it, it will be held in escrow once it confirms.";

/** The session ended or changed mid-link (sign-out or another account): neutral, never the failure line. */
export const GIFT_SESSION_CHANGED_COPY =
  "Your sign-in changed, so this gift wasn't linked to an account. If you sent it, it will be held in escrow once it confirms.";

/**
 * The linked and pending (202) toasts close themselves after this long; the
 * failure toast never does.
 */
export const GIFT_LINKED_AUTO_CLOSE_MS = 10_000;

/** "pending": /record answered 202 (workers#91); neutral, closes itself like "linked". */
export type GiftToastState = "retrying" | "linked" | "pending" | "session" | "failed";

export type GiftLinkInput = {
  /** Captured from the gift's own proposal when the run starts; never re-read. */
  proposalTitle: string;
  record: Parameters<typeof recordContributionWithRetry>[0];
  /** null for the endowment (no claim step). */
  claim: Parameters<typeof claimContributionWithRetry>[0] | null;
  valueSats: number;
  /** Per-caller hook for each retry wait (the modal updates its own line). */
  onRetry?: () => void;
  /**
   * True while the caller's inline line is visible for this gift (modal open
   * and showing it). Then the inline line is the only surface: no toast.
   * Missing: always toast.
   */
  inlineShown?: () => boolean;
};

export function giftKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

/**
 * true: linked; false: stopped (page unload); "pending": /record answered 202
 * (no row yet); "session_changed": the sign-in ended or changed mid-link.
 */
export type GiftLinkResult = boolean | "pending" | "session_changed";

const runs = new Map<string, Promise<GiftLinkResult>>();
/** Running gifts → show their "Linking…" toast if the inline line is gone. */
const surfacers = new Map<string, () => void>();

/**
 * While a gift is linking, any DOM removal outside the toast region (e.g. an
 * in-app page change replacing #app, which takes an #app-hosted Donate modal
 * with it without a close) re-checks the running gifts: one whose inline line
 * is gone gets its "Linking…" toast at once.
 */
let removalWatch: MutationObserver | null = null;

function watchRemovals(): void {
  if (removalWatch || typeof MutationObserver === "undefined" || typeof document === "undefined") return;
  removalWatch = new MutationObserver((records) => {
    const region = document.getElementById("gift-toasts");
    const removedOutsideToasts = records.some(
      (r) => r.removedNodes.length > 0 && !(region && (r.target === region || region.contains(r.target))),
    );
    if (removedOutsideToasts) surfaceGiftLinks();
  });
  removalWatch.observe(document.body, { childList: true, subtree: true });
}

function unwatchIfIdle(): void {
  if (surfacers.size > 0 || !removalWatch) return;
  removalWatch.disconnect();
  removalWatch = null;
}
const toasts = new Map<string, { el: HTMLElement; timer: ReturnType<typeof setTimeout> | null }>();
let generation = 0;

/** Stop every in-flight run (page unload). Stopped runs never touch a toast again. */
export function stopGiftLinks(): void {
  generation += 1;
  runs.clear();
  surfacers.clear();
  unwatchIfIdle();
  // A stopped run's "Keep this page open" would be a lie (e.g. a bfcache restore).
  for (const [key, t] of [...toasts]) {
    if (t.el.dataset.giftState === "retrying") closeGiftToast(key);
  }
}

/** Remove every toast (page teardown / tests). */
export function closeAllGiftToasts(): void {
  for (const key of [...toasts.keys()]) closeGiftToast(key);
}

/**
 * Call when the Donate modal closes: every gift still linking whose inline
 * line is no longer showing gets its "Linking…" toast right away (no silent
 * gap until the next retry or the outcome). The outcome then updates that
 * same toast in place.
 */
export function surfaceGiftLinks(): void {
  for (const surface of [...surfacers.values()]) surface();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", stopGiftLinks);
}

function toastRegion(): HTMLElement {
  let region = document.getElementById("gift-toasts");
  if (!region) {
    region = document.createElement("div");
    region.id = "gift-toasts";
    region.className = "gift-toasts";
    document.body.appendChild(region);
  }
  return region;
}

export function closeGiftToast(key: string): void {
  const t = toasts.get(key);
  if (!t) return;
  if (t.timer) clearTimeout(t.timer);
  t.el.remove();
  toasts.delete(key);
}

function giftToastLine(state: GiftToastState, valueSats: number): string {
  if (state === "retrying") return RECORD_RETRY_STATUS_COPY;
  if (state === "linked") return `Credit linked for ${formatSats(valueSats)}.`;
  if (state === "pending") return RECORD_PENDING_INDEX_COPY;
  if (state === "session") return GIFT_SESSION_CHANGED_COPY;
  return GIFT_LINK_FAILED_COPY;
}

/** One toast per gift. The title only ever goes in through textContent. */
export function showGiftToast(
  key: string,
  title: string,
  state: GiftToastState,
  valueSats = 0,
): HTMLElement {
  let t = toasts.get(key);
  if (!t) {
    const el = document.createElement("div");
    el.className = "gift-toast";
    el.dataset.giftKey = key;
    t = { el, timer: null };
    toasts.set(key, t);
  }
  const { el } = t;
  if (t.timer) clearTimeout(t.timer);
  t.timer = null;
  el.dataset.giftState = state;
  el.setAttribute("role", state === "failed" ? "alert" : "status");
  el.replaceChildren();
  const text = document.createElement("p");
  text.className = "gift-toast-text";
  text.textContent = `Gift to ${title}: ${giftToastLine(state, valueSats)}`;
  el.appendChild(text);
  if (state !== "retrying") {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "gift-toast-close";
    close.textContent = "Close";
    close.addEventListener("click", () => closeGiftToast(key));
    el.appendChild(close);
  }
  if (state === "linked" || state === "pending") {
    t.timer = setTimeout(() => closeGiftToast(key), GIFT_LINKED_AUTO_CLOSE_MS);
  }
  const region = toastRegion();
  if (el.parentElement !== region) region.appendChild(el);
  return el;
}

/**
 * Record (with bounded retries) then claim one gift. Resolves true when
 * linked, false when stopped (unload / session change); rejects with the
 * error on a final refusal or exhausted retries. A second call for the same
 * gift while it runs returns the same run.
 */
export function linkGift(input: GiftLinkInput): Promise<GiftLinkResult> {
  const key = giftKey(input.record.txid, input.record.vout);
  const running = runs.get(key);
  if (running) return running;
  const title = input.proposalTitle;
  const record = { ...input.record };
  const claim = input.claim ? { ...input.claim } : null;
  const startedIn = generation;
  const session = currentSessionToken();
  const live = () => startedIn === generation;
  /** Toast only when the inline line isn't showing this gift (UI UX). */
  const toast = (state: GiftToastState) => {
    if (!live()) return;
    if (input.inlineShown?.()) closeGiftToast(key);
    else showGiftToast(key, title, state, input.valueSats);
  };
  const stillLinking = () => live() && currentSessionToken() === session;
  let run!: Promise<GiftLinkResult>;
  run = (async () => {
    try {
      const outcome = await recordContributionWithRetry(record, {
        onRetry: () => {
          toast("retrying");
          input.onRetry?.();
        },
        shouldContinue: stillLinking,
      });
      if (outcome === "pending_index") {
        // 202: nothing to link yet. Modal showing this gift: the caller's
        // neutral line only. Otherwise the same line as a neutral toast.
        toast("pending");
        return "pending";
      }
      if (claim) {
        if (!stillLinking()) throw new RecordRetryCancelled();
        await claimContributionWithRetry(claim, { shouldContinue: stillLinking });
      }
      toast("linked");
      return true;
    } catch (e) {
      if (e instanceof RecordRetryCancelled) {
        // Page unload: stop quietly.
        if (!live()) return false;
        // Sign-out or another account: one neutral line (toast rule as
        // always), never the failure line.
        toast("session");
        return "session_changed";
      }
      toast("failed");
      throw e;
    } finally {
      if (runs.get(key) === run) {
        runs.delete(key);
        surfacers.delete(key);
        unwatchIfIdle();
      }
    }
  })();
  runs.set(key, run);
  surfacers.set(key, () => {
    if (!live() || input.inlineShown?.()) return;
    if (toasts.get(key)?.el.dataset.giftState === "retrying") return; // already showing
    showGiftToast(key, title, "retrying", input.valueSats);
  });
  watchRemovals();
  return run;
}
