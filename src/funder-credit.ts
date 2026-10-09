import { authFetch } from "./auth";
import { WORKERS_API } from "./config";
import { addressUtxos, type AddressUtxo } from "./mempool";

const api = () => WORKERS_API.replace(/\/$/, "");

export type CreditPreferences = {
  public_credit: boolean;
  anonymous: boolean;
  show_amount: boolean;
};

const CREDIT_PREFS_STORAGE_KEY = "plebly_funder_credit_prefs";

/** Last chosen display prefs for the donate wizard (skip step 1 when present). */
export function loadStoredCreditPreferences(): CreditPreferences | null {
  try {
    const raw = localStorage.getItem(CREDIT_PREFS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CreditPreferences> & { chosen?: boolean };
    if (!data || data.chosen === false) return null;
    const publicCredit = data.public_credit !== false && data.anonymous !== true;
    return {
      public_credit: publicCredit,
      anonymous: !publicCredit,
      show_amount: Boolean(data.show_amount) && publicCredit,
    };
  } catch {
    return null;
  }
}

export function saveStoredCreditPreferences(prefs: CreditPreferences): void {
  try {
    localStorage.setItem(
      CREDIT_PREFS_STORAGE_KEY,
      JSON.stringify({ ...prefs, chosen: true }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function hasStoredCreditPreferences(): boolean {
  return loadStoredCreditPreferences() != null;
}

/** Sync account/profile defaults into the donate wizard skip cache. */
export function syncStoredCreditPreferencesFromProfile(input: {
  public_credit?: boolean;
  show_amount?: boolean;
  anonymous?: boolean;
} | null | undefined): CreditPreferences | null {
  if (!input) return loadStoredCreditPreferences();
  const publicCredit = input.public_credit !== false && input.anonymous !== true;
  const prefs: CreditPreferences = {
    public_credit: publicCredit,
    anonymous: !publicCredit,
    show_amount: Boolean(input.show_amount) && publicCredit,
  };
  saveStoredCreditPreferences(prefs);
  return prefs;
}

export function applyCreditPreferencesToFields(
  root: ParentNode,
  prefs: CreditPreferences,
  idPrefix = "donate-credit",
): void {
  const publicBox = root.querySelector<HTMLInputElement>(`#${idPrefix}-public`);
  const amountBox = root.querySelector<HTMLInputElement>(`#${idPrefix}-amount`);
  if (publicBox) publicBox.checked = prefs.public_credit && !prefs.anonymous;
  if (amountBox) {
    amountBox.checked = prefs.show_amount && prefs.public_credit && !prefs.anonymous;
    amountBox.disabled = !publicBox?.checked;
  }
}

export function readCreditPreferences(
  root: ParentNode,
  idPrefix = "credit",
): CreditPreferences {
  const publicCredit =
    root.querySelector<HTMLInputElement>(`#${idPrefix}-public`)?.checked !==
    false;
  const showAmount =
    root.querySelector<HTMLInputElement>(`#${idPrefix}-amount`)?.checked ===
    true;
  return {
    public_credit: publicCredit,
    anonymous: !publicCredit,
    show_amount: showAmount && publicCredit,
  };
}

export function creditPreferenceFieldsHtml(opts?: {
  idPrefix?: string;
  nested?: boolean;
  legend?: string | false;
}): string {
  const prefix = opts?.idPrefix ?? "credit";
  const nestedClass = opts?.nested === false ? "" : " funder-credit-check-nested";
  const legend =
    opts?.legend === false
      ? ""
      : `<legend class="donate-amount-label">${opts?.legend ?? "Display"}</legend>`;
  return `<fieldset class="funder-credit-options">
    ${legend}
    <label class="funder-credit-check">
      <input type="checkbox" id="${prefix}-public" checked />
      <span>Show my identity on the funder list</span>
    </label>
    <label class="funder-credit-check${nestedClass}">
      <input type="checkbox" id="${prefix}-amount" />
      <span>Also show my amount</span>
    </label>
  </fieldset>`;
}

/** Keep amount checkbox gated on public identity. */
export function bindCreditPreferenceGates(
  root: ParentNode,
  idPrefix = "credit",
): void {
  const publicBox = root.querySelector<HTMLInputElement>(`#${idPrefix}-public`);
  const amountBox = root.querySelector<HTMLInputElement>(`#${idPrefix}-amount`);
  if (!publicBox || !amountBox) return;
  const sync = () => {
    amountBox.disabled = !publicBox.checked;
    if (!publicBox.checked) amountBox.checked = false;
  };
  publicBox.addEventListener("change", sync);
  sync();
}

export async function recordContribution(input: {
  proposal_id: string;
  txid: string;
  vout: number;
  address: string;
  anonymous?: boolean;
  public_credit?: boolean;
  legal_name?: string;
  proposal_path?: string;
  proposal_title?: string;
}): Promise<void> {
  const res = await authFetch(`${api()}/contributions/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  // Accepted only on 2xx with `ok: true`; anything else is not a recorded gift.
  if (!res.ok || data.ok !== true) {
    throw new Error(data.error || "Could not record contribution.");
  }
}

export async function claimContribution(input: {
  proposal_id: string;
  txid?: string;
  vout?: number;
  swap_id?: string;
  legal_name?: string;
  proposal_path?: string;
  proposal_title?: string;
} & CreditPreferences): Promise<void> {
  const res = await authFetch(`${api()}/contributions/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  // Credit is linked only when the server accepts the claim (2xx + `ok: true`).
  if (!res.ok || data.ok !== true) {
    throw new Error(data.error || "Could not link funder credit.");
  }
}

export async function updateCreditPreferences(input: {
  proposal_id: string;
  txid?: string;
  vout?: number;
  swap_id?: string;
} & CreditPreferences): Promise<void> {
  const res = await authFetch(`${api()}/contributions/credit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not save credit preference.");
}

export function utxoKey(u: Pick<AddressUtxo, "txid" | "vout">): string {
  return `${u.txid}:${u.vout}`;
}

/**
 * Poll for new UTXOs after a baseline snapshot.
 *
 * Only UTXOs first seen after a successful baseline read count as new. If the
 * first read fails, the watcher stays without a baseline and the next
 * successful read becomes the baseline quietly (no `onNew`): an unreadable
 * address is not an empty one, and treating it as empty would hand every
 * existing UTXO (someone else's earlier payment) to the current donor.
 */
export function watchNewUtxos(
  address: string,
  onNew: (utxos: AddressUtxo[]) => void,
  opts?: {
    intervalMs?: number;
    baseline?: Set<string>;
    /**
     * `"unavailable"`: the first read failed, so deposits can't be matched yet.
     * `"ready"`: a baseline exists (first read, or the first good read after).
     */
    onBaselineState?: (state: "unavailable" | "ready") => void;
  },
): { stop: () => void; ready: Promise<void> } {
  const intervalMs = opts?.intervalMs ?? 8000;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let known: Set<string> | null = opts?.baseline ?? null;

  const tick = async () => {
    if (stopped) return;
    try {
      const utxos = await addressUtxos(address);
      // stop() may have run while the read was in flight (modal closed).
      if (stopped) return;
      if (known == null) {
        known = new Set(utxos.map(utxoKey));
        if (!stopped) opts?.onBaselineState?.("ready");
        return;
      }
      const seen = known;
      const fresh = utxos.filter((u) => !seen.has(utxoKey(u)));
      for (const u of utxos) seen.add(utxoKey(u));
      if (fresh.length) onNew(fresh);
    } catch {
      /* ignore transient explorer errors */
    }
  };

  const ready = (async () => {
    try {
      const utxos = await addressUtxos(address);
      known = new Set(utxos.map(utxoKey));
    } catch {
      // Keep the caller's baseline, or stay without one: the next successful
      // tick then sets it quietly instead of announcing existing UTXOs.
    }
    if (!stopped) {
      opts?.onBaselineState?.(known == null ? "unavailable" : "ready");
    }
    if (!stopped) {
      timer = setInterval(() => void tick(), intervalMs);
    }
  })();

  return {
    ready,
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** Retry claim a few times while the indexer catches up (esp. Lightning). */
export async function claimContributionWithRetry(
  input: Parameters<typeof claimContribution>[0],
  opts?: { attempts?: number; delayMs?: number },
): Promise<void> {
  const attempts = opts?.attempts ?? 6;
  const delayMs = opts?.delayMs ?? 2500;
  let lastError: Error | null = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      await claimContribution(input);
      return;
    } catch (e) {
      lastError = e as Error;
      const msg = lastError.message.toLowerCase();
      if (msg.includes("already claimed")) throw lastError;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError || new Error("Could not link funder credit.");
}
