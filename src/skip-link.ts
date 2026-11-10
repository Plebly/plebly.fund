/**
 * Keep a single "Skip to content" control, focus #main-content on activate,
 * and give main a tabindex so it can take keyboard focus.
 */

export const SKIP_LINK_SELECTOR = 'a.skip-link[href$="#main-content"]';

export function ensureMainFocusTarget(
  root: ParentNode | Document = document,
): HTMLElement | null {
  const main = root.querySelector<HTMLElement>("#main-content");
  if (!main) return null;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  return main;
}

/** Move keyboard focus into main. Used by the skip link. */
export function focusMainContent(
  root: ParentNode | Document = document,
  event?: Event,
): void {
  const main = ensureMainFocusTarget(root);
  if (!main) return;
  event?.preventDefault();
  main.focus({ preventScroll: false });
}

export function bindSkipLink(root: ParentNode | Document = document): void {
  const doc = root instanceof Document ? root : root.ownerDocument || document;
  for (const link of root.querySelectorAll<HTMLAnchorElement>(SKIP_LINK_SELECTOR)) {
    if (link.dataset.skipBound === "1") continue;
    link.dataset.skipBound = "1";
    link.addEventListener("click", (event) => {
      focusMainContent(doc, event);
    });
  }
  ensureMainFocusTarget(root);
}
