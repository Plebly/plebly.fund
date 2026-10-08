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

export function profileHasCreditPreferences(input: {
  funder_credit?: { public_credit?: boolean; show_amount?: boolean } | null;
} | null | undefined): boolean {
  return Boolean(input?.funder_credit);
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
}): Promise<RecordOutcome> {
  const res = await authFetch(`${api()}/contributions/record`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 202) return "pending_index";
  if (!res.ok) throw new Error(data.error || "Could not record contribution.");
  return "recorded";
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
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Could not link funder credit.");
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

/** Poll for new UTXOs after a baseline snapshot. */
export function watchNewUtxos(
  address: string,
  onNew: (utxos: AddressUtxo[]) => void,
  opts?: { intervalMs?: number; baseline?: Set<string> },
): { stop: () => void; ready: Promise<void> } {
  const intervalMs = opts?.intervalMs ?? 8000;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let known = opts?.baseline ?? new Set<string>();

  const tick = async () => {
    if (stopped) return;
    try {
      const utxos = await addressUtxos(address);
      const fresh = utxos.filter((u) => !known.has(utxoKey(u)));
      for (const u of utxos) known.add(utxoKey(u));
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
      known = new Set();
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

/**
 * `/contributions/record` retry for the Donate modal.
 *
 * Retries only transient failures: 5xx (incl. workers' 503
 * `contribution_busy`) and network errors. 4xx (incl. every 409) and a 2xx
 * without `ok: true` are final. The whole window stays well inside one escrow
 * indexer period (workers cron, every 5 minutes): once the indexer records the
 * gift anonymously, a later session record is refused for good.
 */
export const RECORD_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000] as const;
/** No new attempt starts after this many ms from the first one. */
export const RECORD_RETRY_WINDOW_MS = 60_000;

/**
 * workers#91: /record answers 202 (code pending_index) when it wrote no row
 * yet; the indexer adds the gift at 2 confirmations. Not an error, not
 * "Credit linked", never retried. (Main never returns 202.)
 */
export const RECORD_PENDING_INDEX_COPY =
  "Thanks. Your gift will show on this proposal after 2 confirmations.";
export type RecordOutcome = "recorded" | "pending_index";

/** Thrown when the caller stops a /record retry loop (modal closed, stop(), session changed). */
export class RecordRetryCancelled extends Error {
  constructor() {
    super("Linking stopped.");
    this.name = "RecordRetryCancelled";
  }
}

/** Donate modal status while transient /record failures are being retried. */
export const RECORD_RETRY_STATUS_COPY =
  "Linking your gift to your account… Keep this page open.";

export async function recordContributionWithRetry(
  input: Parameters<typeof recordContribution>[0],
  opts?: {
    delaysMs?: readonly number[];
    windowMs?: number;
    /** Called before each wait, i.e. only once a transient failure will be retried. */
    onRetry?: () => void;
    /** Checked before and after each wait; false stops the loop with RecordRetryCancelled. */
    shouldContinue?: () => boolean;
  },
): Promise<RecordOutcome> {
  const delays = opts?.delaysMs ?? RECORD_RETRY_DELAYS_MS;
  const windowMs = opts?.windowMs ?? RECORD_RETRY_WINDOW_MS;
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    let lastError: Error;
    let res: Response | null = null;
    try {
      res = await authFetch(`${api()}/contributions/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch (e) {
      lastError = e instanceof Error ? e : new Error("Could not record contribution.");
    }
    if (res) {
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.status === 202) return "pending_index"; // workers#91: no row yet, final
      if (res.ok && data.ok === true) return "recorded";
      lastError = new Error(data.error || "Could not record contribution.");
      // Final: 4xx (409 included) and an unaccepted 2xx are answers, not outages.
      if (res.status < 500) throw lastError;
    }
    const delay = delays[attempt];
    if (delay == null || Date.now() - started + delay > windowMs) throw lastError!;
    if (opts?.shouldContinue && !opts.shouldContinue()) throw new RecordRetryCancelled();
    opts?.onRetry?.();
    await new Promise((r) => setTimeout(r, delay));
    if (opts?.shouldContinue && !opts.shouldContinue()) throw new RecordRetryCancelled();
  }
}
