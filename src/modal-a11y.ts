/**
 * One keyboard contract for every `.site-modal` dialog (donate, claim, share,
 * confirm/prompt, report, terms, keyholder session/revoke/detail):
 *
 * - Tab / Shift+Tab stay inside the topmost open modal (wrapping at the ends).
 * - Esc closes the topmost modal by pressing its own close control, when the
 *   modal's own handler didn't already close it.
 * - On close, focus goes back to the control that opened the modal.
 *
 * Installed once at startup. It watches the DOM instead of hooking each
 * modal, so new dialogs get the same behaviour as long as they use the
 * shared `.site-modal` + `[aria-modal="true"]` markup.
 */

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable='true']",
  "[tabindex]",
].join(",");

/** True when `el` is a `.site-modal` currently on screen. */
export function isModalOpen(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (!el.isConnected || el.hidden) return false;
  if (el.closest("[hidden]")) return false;
  return !!el.querySelector("[aria-modal='true']");
}

/** All open modals in document order; the last one is on top. */
export function openModals(doc: Document = document): HTMLElement[] {
  return Array.from(doc.querySelectorAll(".site-modal")).filter(isModalOpen);
}

export function topModal(doc: Document = document): HTMLElement | null {
  const all = openModals(doc);
  return all.length ? all[all.length - 1] : null;
}

/**
 * True when `el` is actually on screen inside `root`: no `hidden`/`inert`
 * ancestor, no `display: none` from CSS on it or an ancestor (e.g. the
 * Lightning compose row in its wait/done phases), and not `visibility: hidden`.
 */
export function isRenderedIn(el: HTMLElement, root: Element): boolean {
  const view = el.ownerDocument.defaultView;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n !== root && (n.hidden || n.hasAttribute("inert"))) return false;
    if (view && view.getComputedStyle(n).display === "none") return false;
    if (n === root) break;
  }
  if (view && view.getComputedStyle(el).visibility === "hidden") return false;
  return true;
}

/** Tabbable controls inside `root`, in DOM order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => {
      const ti = el.getAttribute("tabindex");
      if (ti !== null && Number(ti) < 0) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;
      return isRenderedIn(el, root);
    },
  );
}

function hiddenWithin(el: HTMLElement, root: HTMLElement): boolean {
  const h = el.closest("[hidden]");
  return !!h && h !== root && root.contains(h);
}

/** The control that closes `modal` when pressed, if it has one. */
export function modalCloseControl(modal: HTMLElement): HTMLElement | null {
  const close = modal.querySelector<HTMLElement>(".site-modal-close");
  if (close && !hiddenWithin(close, modal)) return close;
  const backdrop = modal.querySelector<HTMLElement>(".site-modal-backdrop");
  if (
    backdrop &&
    Array.from(backdrop.attributes).some((a) =>
      /^data-.*(close|cancel)/.test(a.name),
    )
  ) {
    return backdrop;
  }
  return null;
}

function focusInto(modal: HTMLElement, last = false): void {
  const items = focusableIn(modal);
  const target = last ? items[items.length - 1] : items[0];
  if (target) {
    target.focus();
    return;
  }
  const card = modal.querySelector<HTMLElement>("[aria-modal='true']");
  if (card) {
    if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");
    card.focus();
  }
}

let installed: (() => void) | null = null;

/**
 * Install the shared modal keyboard handling. Idempotent; returns an
 * uninstall function (used by tests).
 */
export function installModalA11y(doc: Document = document): () => void {
  if (installed) return installed;
  const win = doc.defaultView || window;

  /** Recent controls the user focused or pressed, newest last. */
  const recent: HTMLElement[] = [];
  const remember = (el: HTMLElement) => {
    const i = recent.indexOf(el);
    if (i !== -1) recent.splice(i, 1);
    recent.push(el);
    if (recent.length > 8) recent.shift();
  };
  const openers = new Map<HTMLElement, HTMLElement | null>();
  let known = new Set<HTMLElement>();

  const isControl = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLElement && el !== doc.body && el !== doc.documentElement;

  const onFocusIn = (ev: FocusEvent) => {
    const t = ev.target as Element | null;
    if (isControl(t)) remember(t);
  };
  // Safari does not focus buttons on click, so record the pressed control too.
  const onPointer = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    const ctl = t.closest<HTMLElement>(
      "button, a[href], [role='button'], input, select, textarea, [tabindex]",
    );
    if (isControl(ctl)) remember(ctl);
  };

  const sync = () => {
    const now = new Set(openModals(doc));
    for (const modal of now) {
      if (known.has(modal)) continue;
      const active = doc.activeElement;
      // The opener is the newest control outside this modal (it may sit in
      // another modal underneath, e.g. a confirm opened from a keyholder card).
      let opener: HTMLElement | null = null;
      for (let i = recent.length - 1; i >= 0; i--) {
        const el = recent[i];
        if (el.isConnected && !modal.contains(el)) {
          opener = el;
          break;
        }
      }
      openers.set(modal, opener);
      const inside = active instanceof Node && modal.contains(active);
      if (!inside && modal === topModal(doc)) focusInto(modal);
    }
    for (const modal of known) {
      if (now.has(modal)) continue;
      const opener = openers.get(modal) || null;
      openers.delete(modal);
      const active = doc.activeElement as HTMLElement | null;
      const lost =
        !active ||
        active === doc.body ||
        !active.isConnected ||
        modal.contains(active) ||
        !!active.closest("[hidden]");
      if (!lost) continue;
      const under = topModal(doc);
      if (
        opener &&
        opener.isConnected &&
        !opener.closest("[hidden]") &&
        (!under || under.contains(opener))
      ) {
        opener.focus();
        continue;
      }
      if (under) focusInto(under);
    }
    known = now;
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    const modal = topModal(doc);
    if (!modal) return;
    if (ev.key === "Tab") {
      const items = focusableIn(modal);
      const active = doc.activeElement;
      const inside = active instanceof Node && modal.contains(active);
      if (!items.length) {
        ev.preventDefault();
        focusInto(modal);
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!inside) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
        return;
      }
      const idx = items.indexOf(active as HTMLElement);
      if (idx === -1) {
        // Focus is on a non-tabbable node inside the modal (a heading with
        // tabindex=-1, the card itself): step to the neighbour by position.
        const after = items.filter(
          (el) =>
            !!(
              (active as Node).compareDocumentPosition(el) &
              Node.DOCUMENT_POSITION_FOLLOWING
            ),
        );
        const before = items.filter((el) => !after.includes(el));
        ev.preventDefault();
        if (ev.shiftKey) (before[before.length - 1] || last).focus();
        else (after[0] || first).focus();
        return;
      }
      if (ev.shiftKey && idx === 0) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && idx === items.length - 1) {
        ev.preventDefault();
        first.focus();
      }
      return;
    }
    if (ev.key === "Escape" || ev.key === "Esc") {
      // Let the modal's own Esc handler run first; close it ourselves only
      // if it is still open afterwards and nothing inside consumed the key.
      win.setTimeout(() => {
        if (ev.defaultPrevented) return;
        if (!isModalOpen(modal)) return;
        modalCloseControl(modal)?.click();
      }, 0);
    }
  };

  const observer = new win.MutationObserver(sync);
  observer.observe(doc.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["hidden", "inert"],
  });
  doc.addEventListener("focusin", onFocusIn, true);
  doc.addEventListener("pointerdown", onPointer, true);
  doc.addEventListener("click", onPointer, true);
  doc.addEventListener("keydown", onKeyDown, true);
  sync();

  installed = () => {
    observer.disconnect();
    doc.removeEventListener("focusin", onFocusIn, true);
    doc.removeEventListener("pointerdown", onPointer, true);
    doc.removeEventListener("click", onPointer, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    installed = null;
  };
  return installed;
}
