import {
  ABOUT_BELIEFS,
  ABOUT_BITCOIN_NETWORK,
  ABOUT_BUILDERS_HTML,
  ABOUT_INTRO_HTML,
  ABOUT_KEYHOLDERS,
  ABOUT_LIGHTNING_HTML,
  ABOUT_PARAM_LABELS,
  ABOUT_STEPS,
  ABOUT_TRUST_HTML,
} from "./generated/about-data";
import { pleblySocialAccountsHtml } from "./icons";
import { href } from "./router";
import { escapeHtml } from "./util";

export type AboutShell = (inner: string) => string;

const ABOUT_NAV = [
  { id: "beliefs", label: "Beliefs" },
  { id: "how-it-works", label: "How it works" },
  { id: "trust", label: "Trust" },
  { id: "keyholders", label: "Keyholders" },
  { id: "parameters", label: "Parameters" },
  { id: "details", label: "Details" },
] as const;

function aboutNavHtml(): string {
  return `<nav class="about-toc" aria-label="On this page">
    ${ABOUT_NAV.map(
      (item) =>
        `<a class="about-toc-link" href="#${item.id}">${escapeHtml(item.label)}</a>`,
    ).join("")}
  </nav>`;
}

function beliefsHtml(): string {
  if (!ABOUT_BELIEFS.length) return "";
  return `<dl class="about-beliefs">${ABOUT_BELIEFS.map(
    (b) => `<div class="about-belief">
      <dt>${escapeHtml(b.title)}</dt>
      <dd>${b.body}</dd>
    </div>`,
  ).join("")}</dl>`;
}

function flowHtml(): string {
  if (!ABOUT_STEPS.length) return "";
  return `<ol class="about-flow">${ABOUT_STEPS.map(
    (s, i) => `<li>
      <span class="about-flow-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span>
      <span class="about-flow-title">${escapeHtml(s.title)}</span>
      <span class="about-flow-body">${escapeHtml(s.body)}</span>
    </li>`,
  ).join("")}</ol>`;
}

function paramsHtml(): string {
  return `<dl class="about-params">${ABOUT_PARAM_LABELS.map(
    (p) => `<div class="about-param">
      <dt>${escapeHtml(p.label)}</dt>
      <dd>
        <span class="about-param-value">${escapeHtml(p.value)}</span>
        <span class="about-param-hint">${escapeHtml(p.hint)}</span>
      </dd>
    </div>`,
  ).join("")}</dl>`;
}

function networkNoteHtml(): string {
  if (ABOUT_BITCOIN_NETWORK !== "signet") return "";
  return `<p class="about-network-badge" role="status">
    <span class="about-network-badge-dot" aria-hidden="true"></span>
    <span><strong>Signet</strong> for testing · Mainnet launch uses ${escapeHtml(ABOUT_KEYHOLDERS.threshold)}
    · <a href="#keyholders">Keyholders</a></span>
  </p>`;
}

function keyholdersHtml(): string {
  const kh = ABOUT_KEYHOLDERS;
  const onSignet = ABOUT_BITCOIN_NETWORK === "signet";
  const rosterPublished = kh.roster.some(
    (s) => s.name && s.name.toUpperCase() !== "TBD",
  );
  const anyXpub = kh.roster.some((s) => Boolean(s.xpub?.trim()));

  const status = kh.status
    ? `<p class="about-keyholders-status" role="status">
        <span class="about-keyholders-status-label">Status</span>
        <span>${escapeHtml(kh.status)}</span>
      </p>`
    : "";

  const signetBlock =
    onSignet && (kh.signetLead || kh.signetCaveats.length)
      ? `<div class="about-keyholders-signet">
          <h3>Currently on signet</h3>
          ${
            kh.signetLead
              ? `<p>${escapeHtml(kh.signetLead)}</p>`
              : ""
          }
          ${
            kh.signetCaveats.length
              ? `<ul>${kh.signetCaveats
                  .map((c) => `<li>${escapeHtml(c)}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </div>`
      : "";

  const leadHtml = kh.productionLead
    ? `<p class="about-section-lede">${escapeHtml(
        kh.productionLead
          .replace(/\bhere\b/gi, "on this page")
          .replace(/\s+/g, " ")
          .trim(),
      )}</p>`
    : `<p class="about-section-lede">Escrow is <strong>${escapeHtml(kh.threshold)}</strong> multisig. Plebly never holds a spending key. Public keys are published on this page before mainnet launch.</p>`;

  const rules = kh.rules.length
    ? `<div class="about-keyholders-rules">
        <h3>Rules</h3>
        <ul>${kh.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
      </div>`
    : "";

  const rosterBody = !kh.roster.length
    ? `<p class="muted">Roster not published yet.</p>`
    : anyXpub || rosterPublished
      ? `<div class="about-keyholders-table-wrap">
          <table class="about-keyholders-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                ${anyXpub ? `<th scope="col">xpub / origin</th>` : ""}
              </tr>
            </thead>
            <tbody>${kh.roster
              .map(
                (seat) => `<tr>
              <td class="about-kh-seat">${escapeHtml(seat.seat)}</td>
              <td>${escapeHtml(seat.name || "—")}</td>
              <td>${escapeHtml(seat.role || "—")}</td>
              ${
                anyXpub
                  ? `<td class="mono about-kh-xpub">${escapeHtml(seat.xpub || "—")}</td>`
                  : ""
              }
            </tr>`,
              )
              .join("")}</tbody>
          </table>
        </div>`
      : `<ul class="about-keyholders-seats">${kh.roster
          .map(
            (seat) => `<li class="about-keyholders-seat">
            <span class="about-kh-seat-n">${escapeHtml(seat.seat)}</span>
            <span class="about-kh-seat-name">${escapeHtml(
              seat.name && seat.name.toUpperCase() !== "TBD"
                ? seat.name
                : "Open seat",
            )}</span>
            <span class="about-kh-seat-role">${escapeHtml(
              seat.role || "To be named before mainnet",
            )}</span>
          </li>`,
          )
          .join("")}</ul>
        <p class="about-keyholders-roster-note">Names and public keys will appear here when the mainnet roster is published.</p>`;

  return `<section class="about-section" id="keyholders">
    <h2>Keyholders</h2>
    ${leadHtml}
    ${status}
    ${signetBlock}
    <div class="about-keyholders-meta">
      <div class="about-keyholders-pill">
        <span class="about-keyholders-pill-label">Threshold</span>
        <span class="about-keyholders-pill-value">${escapeHtml(kh.threshold)}</span>
      </div>
      <div class="about-keyholders-pill">
        <span class="about-keyholders-pill-label">Network</span>
        <span class="about-keyholders-pill-value">${escapeHtml(ABOUT_BITCOIN_NETWORK)}</span>
      </div>
      <div class="about-keyholders-pill">
        <span class="about-keyholders-pill-label">Seats</span>
        <span class="about-keyholders-pill-value">${kh.roster.length || 5}</span>
      </div>
    </div>
    ${rules}
    <div class="about-keyholders-roster">
      <h3>Roster</h3>
      ${rosterBody}
    </div>
  </section>`;
}

/** Scroll-spy TOC + soft section reveal. Safe to call after each about render. */
export function bindAboutPage(root: ParentNode = document): () => void {
  const page = root.querySelector<HTMLElement>(".about-page");
  if (!page) return () => {};

  const sections = [
    ...page.querySelectorAll<HTMLElement>(".about-section[id]"),
  ];
  const links = [
    ...page.querySelectorAll<HTMLAnchorElement>(".about-toc-link"),
  ];
  if (!sections.length) return () => {};

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const setActive = (id: string) => {
    for (const link of links) {
      const active = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };

  const visible = new Map<string, number>();
  const tocObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = entry.target.id;
        if (!id) continue;
        if (entry.isIntersecting) visible.set(id, entry.intersectionRatio);
        else visible.delete(id);
      }
      let bestId = "";
      let bestRatio = -1;
      for (const [id, ratio] of visible) {
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestId = id;
        }
      }
      if (bestId) setActive(bestId);
    },
    {
      // Bias toward the section near the sticky TOC / upper viewport.
      rootMargin: "-20% 0px -55% 0px",
      threshold: [0, 0.15, 0.35, 0.55, 0.75],
    },
  );

  for (const section of sections) tocObserver.observe(section);

  let revealObserver: IntersectionObserver | null = null;
  if (!reduceMotion) {
    for (const section of sections) {
      section.classList.add("about-section-pending");
    }
    revealObserver = new IntersectionObserver(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("about-section-in");
          entry.target.classList.remove("about-section-pending");
          obs.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    for (const section of sections) revealObserver.observe(section);
  }

  // Initial active state before any scroll.
  const hashId = location.hash.replace(/^#/, "");
  if (hashId && sections.some((s) => s.id === hashId)) setActive(hashId);
  else if (sections[0]) setActive(sections[0].id);

  return () => {
    tocObserver.disconnect();
    revealObserver?.disconnect();
  };
}

export function renderAbout(shell: AboutShell): void {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const details = [
    ABOUT_BUILDERS_HTML
      ? `<div class="about-detail">
          <h3>For builders</h3>
          <div class="prose-rich">${ABOUT_BUILDERS_HTML}</div>
        </div>`
      : "",
    ABOUT_LIGHTNING_HTML
      ? `<div class="about-detail">
          <h3>Lightning</h3>
          <div class="prose-rich">${ABOUT_LIGHTNING_HTML}</div>
        </div>`
      : "",
    `<div class="about-detail">
      <h3>Reviewers</h3>
      <p>After AI triage, active reviewers confirm deliverables.
        Eligible funders may open removal ballots for documented bad faith. Bootstrap seats stay permanent.</p>
      <p class="about-detail-link"><a href="${href("/reviewers")}">Reviewer governance →</a></p>
    </div>`,
  ]
    .filter(Boolean)
    .join("");

  app.innerHTML = shell(`
    <section class="wrap detail about-page">
      <header class="about-hero">
        <h1>About Plebly</h1>
        <div class="about-lede prose-rich">${ABOUT_INTRO_HTML}</div>
        <div class="about-cta">
          <a class="btn" href="${href("/")}">Browse projects</a>
          <a class="btn ghost" href="${href("/propose")}">Start a project</a>
        </div>
        ${networkNoteHtml()}
      </header>

      ${aboutNavHtml()}

      <section class="about-section" id="beliefs">
        <h2>What we believe</h2>
        ${beliefsHtml()}
      </section>

      <section class="about-section" id="how-it-works">
        <h2>How it works</h2>
        <p class="about-section-lede">Four steps. No custody. Full history in the open.</p>
        ${flowHtml()}
        <p class="about-section-foot">
          <a href="${href("/")}">Browse open projects</a>
          or
          <a href="${href("/propose")}">start a project</a>.
        </p>
      </section>

      ${
        ABOUT_TRUST_HTML
          ? `<section class="about-section" id="trust">
        <h2>Trust model</h2>
        <div class="about-prose prose-rich">${ABOUT_TRUST_HTML}</div>
      </section>`
          : ""
      }

      ${keyholdersHtml()}

      <section class="about-section" id="parameters">
        <h2>Key parameters</h2>
        <p class="about-section-lede">Fixed at launch. Refreshed on every deploy from the public parameter source.</p>
        ${paramsHtml()}
      </section>

      <section class="about-section about-section-details" id="details">
        <h2>Details</h2>
        <div class="about-details">${details}</div>
      </section>

      <section class="about-section about-close" id="involve">
        <h2>Get involved</h2>
        <p class="about-section-lede">Follow updates, fund open work, or start a project.</p>
        <div class="about-cta about-close-cta">
          <a class="btn" href="${href("/propose")}">Start a project</a>
          <a class="btn ghost" href="${href("/")}">Browse projects</a>
        </div>
        <div class="about-close-links">${pleblySocialAccountsHtml()}</div>
      </section>
    </section>
  `);

  bindAboutPage(app);
}
