import { authFetch, currentReturnPath, loginMenuHtml } from "./auth";
import { BITCOIN_NETWORK, WORKERS_API } from "./config";
import { listListedProposals } from "./github";
import { applySeo, href, seoForRoute } from "./router";
import { escapeHtml, formatSats } from "./util";

export type AdminShell = (inner: string) => string;

const API = () => WORKERS_API.replace(/\/$/, "");

type InventoryRow = {
  key: string;
  label: string;
  group: string;
  mutability: string;
  value: string | number | boolean | null;
  configured?: boolean;
  source: string;
  edit_hint?: string;
  open_ballot_id?: string;
};

type Ballot = {
  id: string;
  field: string;
  current_value: string | null;
  proposed_value: string;
  rationale: string;
  need_yes: number;
  tallies?: { yes: number; no: number };
  status: string;
  closes_at: string;
  sole_admin_bootstrap?: boolean;
};

function tabFromSearch(): string {
  const t = new URLSearchParams(location.search).get("tab");
  if (t === "config" || t === "endowment" || t === "votes") return t;
  return "overview";
}

function rowValue(row: InventoryRow): string {
  if (row.mutability === "secret") {
    return row.configured ? "Configured" : "Missing";
  }
  if (row.value === null || row.value === undefined || row.value === "") {
    return "—";
  }
  return String(row.value);
}

function groupRows(rows: InventoryRow[]): Map<string, InventoryRow[]> {
  const map = new Map<string, InventoryRow[]>();
  for (const row of rows) {
    const list = map.get(row.group) || [];
    list.push(row);
    map.set(row.group, list);
  }
  return map;
}

export async function fetchAdminMe(): Promise<{
  admin: boolean;
  github?: string | null;
  error?: string;
}> {
  if (!WORKERS_API) return { admin: false };
  try {
    const res = await authFetch(`${API()}/admin/me`);
    return (await res.json()) as { admin: boolean; github?: string; error?: string };
  } catch {
    return { admin: false };
  }
}

export async function renderAdmin(shell: AdminShell): Promise<void> {
  applySeo(seoForRoute({ name: "admin" }));
  const app = document.querySelector("#app")!;
  const tab = tabFromSearch();
  const ballotFocus = new URLSearchParams(location.search).get("ballot");

  if (!WORKERS_API) {
    app.innerHTML = shell(
      `<section class="wrap-wide"><p class="muted">Workers API not configured.</p></section>`,
    );
    return;
  }

  app.innerHTML = shell(`
    <section class="wrap-wide admin-page">
      <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Admin</p>
      <h1>Platform admin</h1>
      <p class="muted">Checking access…</p>
    </section>
  `);

  const me = await fetchAdminMe();
  if (!me.admin) {
    app.innerHTML = shell(`
      <section class="wrap-wide admin-page">
        <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Admin</p>
        <h1>Platform admin</h1>
        <div class="empty-state">
          <p class="empty-state-title">Access restricted</p>
          <p class="empty-state-body">${escapeHtml(
            me.error ||
              "Sign in with GitHub as a member of the Plebly organization.",
          )}</p>
          <p>${loginMenuHtml(currentReturnPath())}</p>
        </div>
      </section>
    `);
    return;
  }

  const nav = (name: string, label: string) =>
    `<a href="${href("/admin")}?tab=${name}" class="admin-tab${tab === name ? " active" : ""}"${
      tab === name ? ' aria-current="page"' : ""
    }>${label}</a>`;

  const tabs = `<nav class="admin-tabs" aria-label="Admin sections">
    ${nav("overview", "Overview")}
    ${nav("config", "Config")}
    ${nav("endowment", "Endowment")}
    ${nav("votes", "Votes")}
  </nav>`;

  try {
    if (tab === "overview" || tab === "config") {
      const res = await authFetch(`${API()}/admin/config`);
      const data = (await res.json()) as {
        error?: string;
        rows?: InventoryRow[];
        audit?: { at: string; by: string; action: string; fields: string[] }[];
        open_ballots?: Ballot[];
        members_api?: { ok: boolean; error?: string };
      };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const rows = data.rows || [];
      const needs = rows.filter(
        (r) =>
          (r.mutability === "secret" || r.key === "endowment_address") &&
          r.configured === false,
      );

      if (tab === "overview") {
        app.innerHTML = shell(`
          <section class="wrap-wide admin-page">
            <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Admin</p>
            <h1>Platform admin</h1>
            <p class="lede">Signed in as @${escapeHtml(me.github || "")}. Config changes for money routing require a quorum vote.</p>
            ${tabs}
            <div class="admin-panel">
              <h2>Status</h2>
              <ul class="admin-status-list">
                <li>Org members API: <strong>${data.members_api?.ok ? "ok" : "blocked"}</strong>
                  ${data.members_api?.error ? `<span class="muted"> — ${escapeHtml(data.members_api.error)}</span>` : ""}
                </li>
                <li>Open config ballots: <strong>${(data.open_ballots || []).length}</strong></li>
                <li>Needs attention: <strong>${needs.length}</strong></li>
              </ul>
              <h2>Recent audit</h2>
              ${(data.audit || []).length
                ? `<ul class="admin-audit">${(data.audit || [])
                    .slice(0, 12)
                    .map(
                      (a) =>
                        `<li><span class="mono">${escapeHtml(a.at.slice(0, 19))}</span> ${escapeHtml(a.action)} <span class="muted">${escapeHtml(a.fields.join(", "))}</span></li>`,
                    )
                    .join("")}</ul>`
                : `<p class="muted">No audit entries yet.</p>`}
            </div>
          </section>
        `);
        return;
      }

      // config tab — default to editable so deploy-only/secrets don't dominate
      const filter =
        new URLSearchParams(location.search).get("filter") || "editable";
      const filtered =
        filter === "editable"
          ? rows.filter(
              (r) => r.mutability === "soft" || r.mutability === "quorum",
            )
          : filter === "attention"
            ? needs
            : rows;
      const groups = groupRows(filtered);
      const body = [...groups.entries()]
        .map(([group, list]) => {
          const items = list
            .map((row) => {
              const soft = row.mutability === "soft";
              const quorum = row.mutability === "quorum";
              let controls = "";
              if (soft && !["display_balance_sats", "funded_proposal_ids", "admin_note"].includes(row.key)) {
                const isBool =
                  row.key === "lightning_enabled" ||
                  typeof row.value === "boolean";
                const control = isBool
                  ? `<select data-soft-key="${escapeHtml(row.key)}" data-soft-type="boolean">
                      <option value="" ${row.value === null || row.value === undefined ? "selected" : ""}>Default (env)</option>
                      <option value="true" ${row.value === true ? "selected" : ""}>On</option>
                      <option value="false" ${row.value === false ? "selected" : ""}>Off</option>
                    </select>`
                  : `<input data-soft-key="${escapeHtml(row.key)}" value="${escapeHtml(
                      row.value === null || row.value === undefined
                        ? ""
                        : String(row.value),
                    )}" />`;
                controls = `<div class="admin-row-edit">
                  ${control}
                  <button type="button" class="btn btn-compact" data-soft-save="${escapeHtml(row.key)}">Save</button>
                  <button type="button" class="btn ghost btn-compact" data-soft-clear="${escapeHtml(row.key)}">Clear</button>
                </div>`;
              }
              if (quorum) {
                const signet = BITCOIN_NETWORK.toLowerCase() === "signet";
                controls = `<div class="admin-row-edit">
                  <input data-quorum-field="${escapeHtml(row.key)}" placeholder="New address" />
                  <input data-quorum-rationale="${escapeHtml(row.key)}" placeholder="Rationale" />
                  ${
                    signet
                      ? ""
                      : `<label class="admin-sole"><input type="checkbox" data-quorum-sole="${escapeHtml(row.key)}" /> Sole admin bootstrap</label>`
                  }
                  <button type="button" class="btn btn-compact" data-quorum-propose="${escapeHtml(row.key)}" ${
                    row.open_ballot_id ? "disabled" : ""
                  }>Propose change</button>
                  ${
                    row.open_ballot_id
                      ? `<a href="${href("/admin")}?tab=votes&ballot=${encodeURIComponent(row.open_ballot_id)}">Open ballot</a>`
                      : ""
                  }
                </div>`;
              }
              return `<div class="admin-config-row" data-mutability="${escapeHtml(row.mutability)}">
                <div>
                  <strong>${escapeHtml(row.label)}</strong>
                  <span class="pill">${escapeHtml(row.mutability)}</span>
                  <span class="muted mono">${escapeHtml(row.source)}</span>
                  <p class="mono admin-config-value">${escapeHtml(rowValue(row))}</p>
                  ${row.edit_hint ? `<p class="hint">${escapeHtml(row.edit_hint)}</p>` : ""}
                </div>
                ${controls}
              </div>`;
            })
            .join("");
          return `<section class="admin-config-group"><h2>${escapeHtml(group)}</h2>${items}</section>`;
        })
        .join("");

      app.innerHTML = shell(`
        <section class="wrap-wide admin-page">
          <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Admin</p>
          <h1>Platform admin</h1>
          ${tabs}
          <p class="admin-filters">
            <a href="${href("/admin")}?tab=config&filter=editable"${filter === "editable" ? ' aria-current="page"' : ""}>Editable</a>
            <a href="${href("/admin")}?tab=config&filter=attention"${filter === "attention" ? ' aria-current="page"' : ""}>Needs attention</a>
            <a href="${href("/admin")}?tab=config&filter=all"${filter === "all" ? ' aria-current="page"' : ""}>All inventory</a>
          </p>
          <p class="muted" id="admin-config-msg" aria-live="polite"></p>
          ${body}
        </section>
      `);

      const msg = app.querySelector("#admin-config-msg");
      app.querySelectorAll<HTMLButtonElement>("[data-soft-save]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const key = btn.dataset.softSave!;
          const input = app.querySelector<HTMLInputElement | HTMLSelectElement>(
            `[data-soft-key="${key}"]`,
          );
          let value: string | boolean | null = input?.value ?? "";
          if (input?.dataset.softType === "boolean") {
            const v = String(value).trim().toLowerCase();
            value = v === "" ? null : v === "true";
          }
          const res = await authFetch(`${API()}/admin/config`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ [key]: value }),
          });
          const data = (await res.json()) as { error?: string };
          if (msg) {
            msg.textContent = res.ok
              ? `Saved ${key}.`
              : data.error || `Save failed (${res.status})`;
          }
          if (res.ok) void renderAdmin(shell);
        });
      });
      app.querySelectorAll<HTMLButtonElement>("[data-soft-clear]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const key = btn.dataset.softClear!;
          const res = await authFetch(`${API()}/admin/config`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ [key]: null }),
          });
          const data = (await res.json()) as { error?: string };
          if (msg) {
            msg.textContent = res.ok
              ? `Cleared ${key} override.`
              : data.error || "Clear failed";
          }
          if (res.ok) void renderAdmin(shell);
        });
      });
      app.querySelectorAll<HTMLButtonElement>("[data-quorum-propose]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const field = btn.dataset.quorumPropose!;
          const proposed = app.querySelector<HTMLInputElement>(
            `[data-quorum-field="${field}"]`,
          )?.value;
          const rationale = app.querySelector<HTMLInputElement>(
            `[data-quorum-rationale="${field}"]`,
          )?.value;
          const signet = BITCOIN_NETWORK.toLowerCase() === "signet";
          const sole = signet
            ? true
            : Boolean(
                app.querySelector<HTMLInputElement>(
                  `[data-quorum-sole="${field}"]`,
                )?.checked,
              );
          if (!proposed?.trim()) {
            if (msg) msg.textContent = "Enter a proposed value.";
            return;
          }
          if (
            !confirm(
              signet
                ? `Apply ${field} change on signet?\n\nWith a single linked admin this applies immediately.`
                : `Propose changing ${field}?\n\nThis opens a quorum ballot (or applies immediately if you are the sole linked admin).`,
            )
          ) {
            return;
          }
          const res = await authFetch(`${API()}/admin/ballots`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              field,
              proposed_value: proposed.trim(),
              rationale: rationale || "",
              sole_admin_bootstrap: sole,
            }),
          });
          const data = (await res.json()) as { error?: string; ballot?: Ballot };
          if (msg) {
            msg.textContent = res.ok
              ? `Ballot ${data.ballot?.status || "opened"}.`
              : data.error || "Propose failed";
          }
          if (res.ok) {
            location.href = `${href("/admin")}?tab=votes${
              data.ballot?.id ? `&ballot=${encodeURIComponent(data.ballot.id)}` : ""
            }`;
          }
        });
      });
      return;
    }

    if (tab === "endowment") {
      const [adminRes, listed] = await Promise.all([
        authFetch(`${API()}/endowment/admin`),
        listListedProposals().catch(() => []),
      ]);
      const data = (await adminRes.json()) as {
        error?: string;
        address?: string | null;
        display_balance_sats?: number;
        chain_balance_sats?: number | null;
        funded_proposal_ids?: string[];
        admin_note?: string;
        configured?: boolean;
      };
      if (!adminRes.ok) throw new Error(data.error || `HTTP ${adminRes.status}`);
      const funded = new Set(data.funded_proposal_ids || []);
      const checks = listed
        .filter((p) => p.id)
        .map((p) => {
          const id = p.id!;
          return `<label class="admin-funded-row">
            <input type="checkbox" data-funded-id="${escapeHtml(id)}" ${
              funded.has(id) ? "checked" : ""
            } />
            <span>${escapeHtml(p.title || id)}</span>
            <span class="mono muted">${escapeHtml(id)}</span>
          </label>`;
        })
        .join("");

      app.innerHTML = shell(`
        <section class="wrap-wide admin-page">
          <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Admin</p>
          <h1>Platform admin</h1>
          ${tabs}
          <div class="admin-panel">
            <h2>Endowment</h2>
            <p>Address: <span class="mono">${escapeHtml(data.address || "—")}</span>
              ${!data.configured ? `<span class="pill">not configured</span>` : ""}
            </p>
            <p>Chain balance: <strong class="mono">${
              data.chain_balance_sats == null
                ? "—"
                : escapeHtml(formatSats(data.chain_balance_sats))
            }</strong></p>
            <p>Displayed balance: <strong class="mono">${escapeHtml(
              formatSats(data.display_balance_sats || 0),
            )}</strong></p>
            <div class="admin-row-edit">
              <input id="endowment-display-sats" type="number" min="0" step="1" value="${
                data.display_balance_sats || 0
              }" />
              <button type="button" class="btn" id="endowment-save-display">Save display</button>
              <button type="button" class="btn ghost" id="endowment-copy-chain">Copy chain → display</button>
            </div>
            <label>Admin note
              <textarea id="endowment-note">${escapeHtml(data.admin_note || "")}</textarea>
            </label>
            <h3>Funded projects</h3>
            <div class="admin-funded-list">${checks || `<p class="muted">No catalog projects.</p>`}</div>
            <button type="button" class="btn" id="endowment-save-funded">Save funded set</button>
            <p class="muted" id="endowment-admin-msg" aria-live="polite"></p>
            <p><a href="${href("/endowment")}">View public endowment page</a></p>
          </div>
        </section>
      `);

      const msg = app.querySelector("#endowment-admin-msg");
      app.querySelector("#endowment-save-display")?.addEventListener("click", async () => {
        const sats = Number(
          (app.querySelector("#endowment-display-sats") as HTMLInputElement)
            ?.value,
        );
        const note = (
          app.querySelector("#endowment-note") as HTMLTextAreaElement
        )?.value;
        const res = await authFetch(`${API()}/endowment/admin/display-balance`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            display_balance_sats: Math.floor(sats),
            admin_note: note,
          }),
        });
        const body = (await res.json()) as { error?: string };
        if (msg) {
          msg.textContent = res.ok ? "Display balance saved." : body.error || "Save failed";
        }
      });
      app.querySelector("#endowment-copy-chain")?.addEventListener("click", async () => {
        const res = await authFetch(`${API()}/endowment/admin/display-balance`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ copy_from_chain: true }),
        });
        const body = (await res.json()) as { error?: string };
        if (msg) {
          msg.textContent = res.ok ? "Copied chain balance to display." : body.error || "Copy failed";
        }
        if (res.ok) void renderAdmin(shell);
      });
      app.querySelector("#endowment-save-funded")?.addEventListener("click", async () => {
        const ids = [
          ...app.querySelectorAll<HTMLInputElement>("[data-funded-id]:checked"),
        ].map((el) => el.dataset.fundedId!);
        const res = await authFetch(`${API()}/endowment/admin/funded`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposal_ids: ids }),
        });
        const body = (await res.json()) as { error?: string };
        if (msg) {
          msg.textContent = res.ok
            ? `Saved ${ids.length} funded project(s).`
            : body.error || "Save failed";
        }
      });
      return;
    }

    // votes tab
    const res = await authFetch(`${API()}/admin/ballots`);
    const data = (await res.json()) as {
      error?: string;
      open?: Ballot[];
      roster?: {
        linked_user_ids: string[];
        unlinked_logins: string[];
      } | null;
      roster_error?: string | null;
    };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const open = data.open || [];
    const list = open.length
      ? open
          .map((b) => {
            const focus = ballotFocus === b.id ? " is-focus" : "";
            return `<article class="admin-ballot${focus}" id="ballot-${escapeHtml(b.id)}">
              <h3>${escapeHtml(b.field)}</h3>
              <p class="mono">→ ${escapeHtml(b.proposed_value)}</p>
              <p class="muted">${escapeHtml(b.rationale || "")}</p>
              <p>Yes ${b.tallies?.yes ?? 0} / need ${b.need_yes} · No ${b.tallies?.no ?? 0}</p>
              <p class="muted">Closes ${escapeHtml(b.closes_at.slice(0, 10))} · ${escapeHtml(b.status)}</p>
              <div class="admin-row-edit">
                <button type="button" class="btn" data-vote="${escapeHtml(b.id)}" data-choice="yes">Vote yes</button>
                <button type="button" class="btn ghost" data-vote="${escapeHtml(b.id)}" data-choice="no">Vote no</button>
                <button type="button" class="btn ghost" data-withdraw="${escapeHtml(b.id)}">Withdraw</button>
              </div>
            </article>`;
          })
          .join("")
      : `<p class="muted">No open ballots. Propose address changes from the Config tab.</p>`;

    app.innerHTML = shell(`
      <section class="wrap-wide admin-page">
        <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Admin</p>
        <h1>Platform admin</h1>
        ${tabs}
        <div class="admin-panel">
          <h2>Votes</h2>
          <p class="lede">Money-routing fields need ⌈⅔⌉ yes from linked Plebly org members (min 2). Unlinked org members must sign in before they count toward quorum.</p>
          ${
            data.roster
              ? `<p class="muted">Linked voters: ${data.roster.linked_user_ids.length}. Unlinked: ${data.roster.unlinked_logins.join(", ") || "none"}.</p>`
              : data.roster_error
                ? `<p class="error">${escapeHtml(data.roster_error)}</p>`
                : ""
          }
          <p class="muted" id="admin-votes-msg" aria-live="polite"></p>
          ${list}
        </div>
      </section>
    `);

    const msg = app.querySelector("#admin-votes-msg");
    app.querySelectorAll<HTMLButtonElement>("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.vote!;
        const vote = btn.dataset.choice === "no" ? "no" : "yes";
        const res = await authFetch(`${API()}/admin/ballots/${encodeURIComponent(id)}/vote`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vote }),
        });
        const body = (await res.json()) as { error?: string };
        if (msg) {
          msg.textContent = res.ok ? `Voted ${vote}.` : body.error || "Vote failed";
        }
        if (res.ok) void renderAdmin(shell);
      });
    });
    app.querySelectorAll<HTMLButtonElement>("[data-withdraw]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.withdraw!;
        const res = await authFetch(
          `${API()}/admin/ballots/${encodeURIComponent(id)}/withdraw`,
          { method: "POST" },
        );
        const body = (await res.json()) as { error?: string };
        if (msg) {
          msg.textContent = res.ok ? "Withdrawn." : body.error || "Withdraw failed";
        }
        if (res.ok) void renderAdmin(shell);
      });
    });
    if (ballotFocus) {
      app
        .querySelector(`#ballot-${CSS.escape(ballotFocus)}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (e) {
    app.innerHTML = shell(`
      <section class="wrap-wide admin-page">
        <h1>Platform admin</h1>
        ${tabs}
        <p class="error">${escapeHtml((e as Error).message)}</p>
      </section>
    `);
  }
}
