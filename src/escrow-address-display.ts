import { isSignet, signetFaucetLinksHtml } from "./signet";
import { escapeHtml } from "./util";

/**
 * Readable escrow address: shown in chunks of 4 at a readable size. The gap
 * between chunks is CSS margin on each `<span>` only. No space, `&nbsp;` or any
 * other character is ever inserted, so the element's text, a hand-selected
 * copy and the Copy button all give exactly the address the claim view sent.
 */
export const ESCROW_ADDRESS_CHUNK = 4;
export const ESCROW_SIGNET_ONLY_LINE = "Signet test coins only. Real bitcoin can't be sent here.";
export const ESCROW_COPIED_LINE = "Copied. Deposits show once they confirm.";

export function escrowAddressChunks(address: string, size = ESCROW_ADDRESS_CHUNK): string[] {
  const a = String(address || "").trim();
  const out: string[] = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}

/** Chunk spans with nothing between them (no whitespace text nodes). */
export function escrowAddressChunksHtml(address: string): string {
  return escrowAddressChunks(address)
    .map((c) => `<span class="escrow-addr-chunk">${escapeHtml(c)}</span>`)
    .join("");
}

/** Re-render an existing address element (late claim-view escrow). */
export function renderEscrowAddressInto(el: HTMLElement, address: string): void {
  const a = String(address || "").trim();
  el.innerHTML = escrowAddressChunksHtml(a);
  if (a) el.setAttribute("title", a);
  else el.removeAttribute("title");
}

/** Signet-only line plus faucet links, next to the address. Empty on other networks. */
export function escrowAddressSignetNoteHtml(): string {
  if (!isSignet()) return "";
  return `<p class="escrow-addr-note">${escapeHtml(ESCROW_SIGNET_ONLY_LINE)} <span class="escrow-addr-faucet">Get signet coins: ${signetFaucetLinksHtml({ className: "signet-faucet-links" })}</span></p>`;
}

/** Shown after a copy; hidden until then. */
export function escrowAddressCopiedHtml(): string {
  return `<p class="escrow-addr-copied" role="status" hidden>${escapeHtml(ESCROW_COPIED_LINE)}</p>`;
}

/** Reveal the "deposits show once they confirm" line in the address block. */
export function showEscrowAddressCopied(from: Element): void {
  const block = from.closest("[data-escrow-address-block]");
  const line = block?.querySelector<HTMLElement>(".escrow-addr-copied");
  if (line) line.hidden = false;
}

const ESCROW_COPY_HANDLER_KEY = "__pleblyEscrowCopyHandler";

/**
 * Delegated handler for `[data-escrow-copy]` buttons, so a row builder-panel
 * re-inserts after the claim view loads copies too. Copies the attribute
 * value verbatim (the claim-view address), never the rendered chunks.
 */
export function bindEscrowAddressCopy(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w[ESCROW_COPY_HANDLER_KEY]) return;
  const handler = async (ev: Event) => {
    const btn =
      ev.target instanceof Element
        ? ev.target.closest<HTMLButtonElement>("[data-escrow-copy]")
        : null;
    if (!btn) return;
    const value = btn.getAttribute("data-escrow-copy") || "";
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showEscrowAddressCopied(btn);
      const prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => {
        btn.textContent = prev;
      }, 1200);
    } catch {
      /* ignore */
    }
  };
  document.addEventListener("click", handler);
  w[ESCROW_COPY_HANDLER_KEY] = handler;
}
