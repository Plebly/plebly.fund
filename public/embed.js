(() => {
  const DEFAULT_API = "https://plebly-api.securesovereigns.workers.dev";
  const DEFAULT_SITE = "https://plebly.fund";
  const STYLE = `
    :host { all: initial; display: block; }
    .card { box-sizing: border-box; max-width: 360px; padding: 12px; border: 1px solid #ded7e5; border-left: 4px solid #7828b8; border-radius: 8px; background: #fff; color: #211b28; font: 14px/1.4 system-ui, sans-serif; }
    a { color: inherit; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .title { display: block; font-weight: 700; }
    .meta { margin-top: 4px; color: #5d675d; font-size: 12px; text-transform: capitalize; }
    .track { height: 7px; margin-top: 10px; overflow: hidden; border-radius: 999px; background: #e9eee8; }
    .bar { height: 100%; border-radius: inherit; background: #7828b8; }
    .amount { margin-top: 5px; color: #5d675d; font-size: 12px; }
    .error { color: #8a2727; }
  `;

  const formatSats = (value) =>
    `${new Intl.NumberFormat("en-US").format(Math.round(value))} sats`;

  const render = (mount, markup) => {
    const root = mount.shadowRoot || mount.attachShadow?.({ mode: "open" }) || mount;
    root.innerHTML = `<style>${STYLE}</style>${markup}`;
  };

  const load = async (mount) => {
    const id = mount.dataset.proposalId?.trim();
    if (!id) return;
    const api = (mount.dataset.api || DEFAULT_API).replace(/\/$/, "");
    try {
      const response = await fetch(`${api}/embed/${encodeURIComponent(id)}`, {
        credentials: "omit",
      });
      if (!response.ok) throw new Error("status unavailable");
      const proposal = await response.json();
      const target = Number(proposal.target_sats);
      const balance = Number(proposal.balance_sats);
      const hasFunding = Number.isFinite(target) && target > 0 && Number.isFinite(balance);
      const pct = hasFunding
        ? Math.max(0, Math.min(100, Number(proposal.funding_pct) || (balance / target) * 100))
        : 0;
      const fallbackUrl = `${DEFAULT_SITE}/p/${encodeURIComponent(String(id).trim().toLowerCase())}`;
      let url = fallbackUrl;
      try {
        const candidate = new URL(proposal.url || fallbackUrl);
        const host = candidate.hostname.replace(/^www\./i, "").toLowerCase();
        const allowed =
          host === "plebly.fund" ||
          host === "plebly.github.io";
        if (candidate.protocol === "https:" && allowed) url = candidate.href;
      } catch {
        // Keep the stable Plebly URL when an API response is malformed.
      }
      const funding = hasFunding
        ? `<div class="track" aria-label="${pct.toFixed(0)}% funded"><div class="bar" style="width:${pct}%"></div></div><div class="amount">${formatSats(balance)} of ${formatSats(target)} · ${pct.toFixed(0)}% funded</div>`
        : "";
      render(
        mount,
        `<div class="card"><a class="title" href="${url}" target="_blank" rel="noopener noreferrer"></a><div class="meta"></div>${funding}<div class="fund"><a href="${url}" target="_blank" rel="noopener noreferrer">Fund on Plebly →</a></div></div>`,
      );
      const root = mount.shadowRoot || mount;
      const title = root.querySelector(".title");
      title.href = url;
      title.textContent = proposal.title || id;
      root.querySelector(".meta").textContent = proposal.status || "proposal";
    } catch {
      render(
        mount,
        `<div class="card error">Plebly proposal status is unavailable.</div>`,
      );
    }
  };

  const boot = () =>
    document
      .querySelectorAll(".plebly-embed[data-proposal-id]")
      .forEach((mount) => void load(mount));

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
