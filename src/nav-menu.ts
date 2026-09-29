export const SITE_NAV_ID = "site-nav";

/** Three-bar pancake control; CSS shows it only on the mobile breakpoint. */
export function mobileNavToggleHtml(): string {
  return `<button type="button" class="nav-toggle" aria-expanded="false" aria-controls="${SITE_NAV_ID}" aria-label="Open menu">
      <span class="nav-toggle-pancake" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>`;
}

let documentNavBound = false;

function setNavOpen(header: HTMLElement, btn: HTMLButtonElement, open: boolean): void {
  header.classList.toggle("is-nav-open", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  btn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

function closeOpenNav(): void {
  const header = document.querySelector<HTMLElement>(".site-header.is-nav-open");
  const btn = header?.querySelector<HTMLButtonElement>(".nav-toggle");
  if (!header || !btn) return;
  setNavOpen(header, btn, false);
}

/** Toggle the pancake drawer. Safe to call after every shell render. */
export function bindMobileNav(root: ParentNode = document): void {
  const header = root.querySelector<HTMLElement>(".site-header");
  const btn = header?.querySelector<HTMLButtonElement>(".nav-toggle");
  if (!header || !btn) return;
  if (btn.dataset.navBound === "1") return;
  btn.dataset.navBound = "1";

  btn.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    setNavOpen(header, btn, !header.classList.contains("is-nav-open"));
  });

  header.querySelector(`#${SITE_NAV_ID}`)?.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement | null;
    if (!t) return;
    if (t.closest("a, #logout-btn")) {
      setNavOpen(header, btn, false);
    }
  });

  if (documentNavBound) return;
  documentNavBound = true;
  document.addEventListener("click", (ev) => {
    const openHeader = document.querySelector<HTMLElement>(".site-header.is-nav-open");
    if (!openHeader) return;
    if (openHeader.contains(ev.target as Node)) return;
    closeOpenNav();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const openHeader = document.querySelector<HTMLElement>(".site-header.is-nav-open");
    const toggle = openHeader?.querySelector<HTMLButtonElement>(".nav-toggle");
    closeOpenNav();
    toggle?.focus();
  });
}
