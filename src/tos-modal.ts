import { authFetch } from "./auth";
import { WORKERS_API } from "./config";
import { href } from "./router";

export function tosCheckboxHtml(id: string): string {
  return `<label class="tos-ack-label muted"><input type="checkbox" id="${id}" required /> I accept the <a class="tos-doc-link" href="${href("/terms")}" target="_blank" rel="noopener noreferrer">Terms</a>.</label>`;
}

export async function acceptCurrentTos(): Promise<boolean> {
  const res = await authFetch(`${WORKERS_API.replace(/\/$/, "")}/profile/tos`, {
    method: "POST",
  });
  return res.ok;
}

function ensureModal(): HTMLElement {
  let el = document.getElementById("tos-reack-modal");
  if (el) return el;
  el = document.createElement("div");
  el.id = "tos-reack-modal";
  el.className = "site-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="site-modal-backdrop" data-tos-close tabindex="-1" aria-hidden="true"></div>
    <div class="site-modal-card" role="dialog" aria-modal="true" aria-labelledby="tos-reack-title">
      <h2 id="tos-reack-title">Accept the terms</h2>
      <p class="muted">Please accept the current <a href="${href("/terms")}">Terms</a> to continue.</p>
      ${tosCheckboxHtml("tos-reack-ack")}
      <div class="form-actions">
        <button type="button" class="btn" id="tos-reack-accept">Accept</button>
        <button type="button" class="btn ghost" data-tos-close>Cancel</button>
      </div>
      <p class="builder-msg" id="tos-reack-msg" hidden></p>
    </div>`;
  document.body.appendChild(el);
  return el;
}

export function promptTosAccept(): Promise<boolean> {
  const modal = ensureModal();
  modal.hidden = false;
  const ack = modal.querySelector<HTMLInputElement>("#tos-reack-ack");
  const msg = modal.querySelector<HTMLElement>("#tos-reack-msg");
  if (ack) ack.checked = false;
  if (msg) {
    msg.hidden = true;
    msg.textContent = "";
  }
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      modal.hidden = true;
      modal.removeEventListener("click", onClick);
      resolve(ok);
    };
    const onClick = async (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-tos-close]")) {
        finish(false);
        return;
      }
      if (t?.closest("#tos-reack-accept")) {
        if (!ack?.checked) {
          if (msg) {
            msg.hidden = false;
            msg.textContent = "Check the box to accept.";
            msg.className = "builder-msg error";
          }
          return;
        }
        const ok = await acceptCurrentTos();
        if (!ok && msg) {
          msg.hidden = false;
          msg.textContent = "Could not record acceptance.";
          msg.className = "builder-msg error";
          return;
        }
        finish(ok);
      }
    };
    modal.addEventListener("click", onClick);
  });
}

export async function authFetchWithTos(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const first = await authFetch(input, init);
  if (first.status !== 403) return first;
  const body = (await first.clone().json().catch(() => ({}))) as {
    error?: string;
  };
  if (body.error !== "tos_required") return first;
  const accepted = await promptTosAccept();
  if (!accepted) return first;
  return authFetch(input, init);
}
