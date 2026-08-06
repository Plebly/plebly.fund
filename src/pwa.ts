/** True when launched from home screen / installed PWA (no browser URL bar). */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

export function applyStandaloneClass(): void {
  if (!isStandalonePwa()) return;
  document.documentElement.classList.add("pwa-standalone");
}

/** Register a minimal SW so Chromium offers Install / Add to Home screen. */
export async function registerPwaServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const base = import.meta.env.BASE_URL || "/";
    const swUrl = `${base}sw.js`.replace(/\/{2,}/g, "/");
    const reg = await navigator.serviceWorker.register(swUrl, {
      scope: base,
      updateViaCache: "none",
    });
    queueMicrotask(() => {
      void reg.update();
    });
  } catch {
    /* unsupported scope or private mode — site still works in the browser */
  }
}
