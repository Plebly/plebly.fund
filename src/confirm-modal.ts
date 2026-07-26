import { solidIcon } from "./icons";
import { escapeHtml } from "./util";

export type ConfirmModalOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm control as a destructive action. */
  danger?: boolean;
};

/**
 * Site-modal confirmation (replaces window.confirm).
 * Resolves true on confirm, false on cancel / backdrop / Escape.
 */
export function confirmAction(opts: ConfirmModalOptions): Promise<boolean> {
  const confirmLabel = opts.confirmLabel || "Confirm";
  const cancelLabel = opts.cancelLabel || "Cancel";
  const confirmClass = opts.danger ? "btn danger" : "btn";

  const root = document.createElement("div");
  root.className = "site-modal confirm-modal";
  root.setAttribute("role", "presentation");
  root.innerHTML = `
    <div class="site-modal-backdrop" data-confirm-cancel tabindex="-1" aria-hidden="true"></div>
    <div class="site-modal-card confirm-modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <button type="button" class="site-modal-close" data-confirm-cancel aria-label="Close">${solidIcon("xmark")}</button>
      <h2 id="confirm-modal-title">${escapeHtml(opts.title)}</h2>
      <p class="muted confirm-modal-body">${escapeHtml(opts.body)}</p>
      <div class="form-actions confirm-modal-actions">
        <button type="button" class="btn ghost" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
        <button type="button" class="${confirmClass}" data-confirm-ok autofocus>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;

  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      document.removeEventListener("keydown", onKey);
      root.remove();
      resolve(value);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    };

    root.querySelectorAll("[data-confirm-cancel]").forEach((el) => {
      el.addEventListener("click", () => finish(false));
    });
    root.querySelector("[data-confirm-ok]")?.addEventListener("click", () => {
      finish(true);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>("[data-confirm-ok]")?.focus();
  });
}
