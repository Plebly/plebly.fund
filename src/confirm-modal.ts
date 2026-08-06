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

export type PromptModalOptions = {
  title: string;
  body: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional client-side check; return an error message to keep the modal open. */
  validate?: (value: string) => string | null;
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

/**
 * Site-modal text prompt (replaces window.prompt).
 * Resolves trimmed string on confirm, null on cancel / backdrop / Escape.
 */
export function promptText(opts: PromptModalOptions): Promise<string | null> {
  const confirmLabel = opts.confirmLabel || "Save";
  const cancelLabel = opts.cancelLabel || "Cancel";
  const inputId = `prompt-modal-input-${crypto.randomUUID()}`;

  const root = document.createElement("div");
  root.className = "site-modal confirm-modal";
  root.setAttribute("role", "presentation");
  root.innerHTML = `
    <div class="site-modal-backdrop" data-confirm-cancel tabindex="-1" aria-hidden="true"></div>
    <div class="site-modal-card confirm-modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <button type="button" class="site-modal-close" data-confirm-cancel aria-label="Close">${solidIcon("xmark")}</button>
      <h2 id="confirm-modal-title">${escapeHtml(opts.title)}</h2>
      <p class="muted confirm-modal-body">${escapeHtml(opts.body)}</p>
      <label class="sr-only" for="${escapeHtml(inputId)}">${escapeHtml(opts.title)}</label>
      <input id="${escapeHtml(inputId)}" class="donate-amount mono" type="text" value="${escapeHtml(opts.defaultValue || "")}" placeholder="${escapeHtml(opts.placeholder || "")}" autocomplete="off" />
      <p class="builder-msg error" data-prompt-error hidden></p>
      <div class="form-actions confirm-modal-actions">
        <button type="button" class="btn ghost" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
        <button type="button" class="btn" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
      </div>
    </div>
  `;

  return new Promise((resolve) => {
    const input = root.querySelector<HTMLInputElement>("input.donate-amount");
    const errEl = root.querySelector<HTMLElement>("[data-prompt-error]");
    const finish = (value: string | null) => {
      document.removeEventListener("keydown", onKey);
      root.remove();
      resolve(value);
    };
    const submit = () => {
      const value = input?.value.trim() || "";
      if (opts.validate) {
        const err = opts.validate(value);
        if (err) {
          if (errEl) {
            errEl.hidden = false;
            errEl.textContent = err;
          }
          input?.focus();
          return;
        }
      }
      if (!value) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = "Enter a value.";
        }
        input?.focus();
        return;
      }
      finish(value);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(null);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        submit();
      }
    };

    root.querySelectorAll("[data-confirm-cancel]").forEach((el) => {
      el.addEventListener("click", () => finish(null));
    });
    root.querySelector("[data-confirm-ok]")?.addEventListener("click", submit);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(root);
    input?.focus();
    input?.select();
  });
}
