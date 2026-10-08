/**
 * A tab left open across a deploy still points at the old build's hashed
 * chunks, which the new deploy no longer serves. The next lazy route (or any
 * dynamic import) then rejects. Without a handler that rejection is uncaught
 * and the view stays blank or half-painted. Show one calm reload prompt instead
 * of a blank view or a raw error.
 */
export const STALE_BUILD_MESSAGE =
  "Plebly was updated while this tab was open. Please reload.";

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (?:CSS )?chunk \S+ failed/i;

/** True for the errors browsers / Vite raise when a code-split chunk 404s. */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: unknown }).name;
  if (name === "ChunkLoadError") return true;
  const message =
    typeof err === "string" ? err : String((err as { message?: unknown }).message ?? "");
  return CHUNK_ERROR.test(message);
}

/** Replace the view with the reload prompt (never the raw error). Idempotent. */
export function showStaleBuildPrompt(
  doc: Document = document,
  reload: () => void = () => location.reload(),
): void {
  const app = doc.querySelector<HTMLElement>("#app") || doc.body;
  app.innerHTML = `<section class="wrap-wide detail stale-build" data-stale-build role="alert">
    <p class="lede">${STALE_BUILD_MESSAGE}</p>
    <p><button type="button" class="btn" data-stale-reload>Reload</button></p>
  </section>`;
  app
    .querySelector<HTMLButtonElement>("[data-stale-reload]")
    ?.addEventListener("click", () => reload());
}

/**
 * Listen for Vite's `vite:preloadError` and for unhandled chunk-load
 * rejections (e.g. a lazy route's `await import()` inside render()). Other
 * errors are left alone.
 */
export function installStaleChunkReload(
  win: Window = window,
  reload: () => void = () => win.location.reload(),
): () => void {
  // Not prevented on purpose: Vite then rethrows the original chunk error, so
  // the awaiting code stops (instead of continuing with an undefined module)
  // and the rejection lands in onRejection below.
  const onPreload = () => {
    showStaleBuildPrompt(win.document, reload);
  };
  const onRejection = (ev: Event) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    if (!isChunkLoadError(reason)) return;
    ev.preventDefault();
    showStaleBuildPrompt(win.document, reload);
  };
  win.addEventListener("vite:preloadError", onPreload);
  win.addEventListener("unhandledrejection", onRejection);
  return () => {
    win.removeEventListener("vite:preloadError", onPreload);
    win.removeEventListener("unhandledrejection", onRejection);
  };
}
