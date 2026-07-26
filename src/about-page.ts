import {
  ABOUT_BELIEFS,
  ABOUT_BITCOIN_NETWORK,
  ABOUT_BUILDERS_HTML,
  ABOUT_INTRO_HTML,
  ABOUT_LIGHTNING_HTML,
  ABOUT_PARAM_LABELS,
  ABOUT_STEPS,
  ABOUT_TRUST_HTML,
} from "./generated/about-data";
import { pleblySocialAccountsHtml } from "./icons";
import { href } from "./router";
import { escapeHtml } from "./util";

export type AboutShell = (inner: string) => string;

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
    (s) => `<li>
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
  return `<p class="about-network-note">
    Running on <strong>signet</strong> for testing.
    Launch is <strong>mainnet</strong> with 3-of-5 multisig.
    See
    <a href="https://github.com/Plebly/proposals/blob/main/KEYHOLDERS.md" target="_blank" rel="noreferrer">keyholders</a>.
  </p>`;
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
        Eligible funders may open removal ballots for documented bad faith. Bootstrap seats stay permanent.
        <a href="${href("/reviewers")}">Reviewer governance</a>
        ·
        <a href="https://github.com/Plebly/proposals/blob/main/REVIEWERS.md" target="_blank" rel="noreferrer">REVIEWERS.md</a>
      </p>
    </div>`,
  ]
    .filter(Boolean)
    .join("");

  app.innerHTML = shell(`
    <section class="wrap-wide detail about-page">
      <header class="about-hero">
        <h1>Plebly</h1>
        <div class="about-lede prose-rich">${ABOUT_INTRO_HTML}</div>
        <div class="about-cta">
          <a class="btn" href="${href("/")}">Browse projects</a>
          <a class="btn ghost" href="${href("/propose")}">Start a project</a>
        </div>
        ${networkNoteHtml()}
      </header>

      <section class="about-section" id="beliefs">
        <h2>What we believe</h2>
        ${beliefsHtml()}
      </section>

      ${
        ABOUT_TRUST_HTML
          ? `<section class="about-section" id="trust">
        <h2>Trust model</h2>
        <div class="about-prose prose-rich">${ABOUT_TRUST_HTML}</div>
      </section>`
          : ""
      }

      <section class="about-section" id="how-it-works">
        <h2>How it works</h2>
        ${flowHtml()}
        <p class="about-section-foot">
          <a href="${href("/")}">Browse open projects</a>,
          <a href="${href("/propose")}">start a project</a>,
          or read the full rules in the
          <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">proposals repo</a>.
        </p>
      </section>

      <section class="about-section" id="parameters">
        <h2>Key parameters</h2>
        <p class="about-section-lede">Fixed at launch from
          <a href="https://github.com/Plebly/proposals/blob/main/PARAMETERS.md" target="_blank" rel="noreferrer">PARAMETERS.md</a>.
          Browse vocabulary guidance in
          <a href="https://github.com/Plebly/proposals/blob/main/TAGS.md" target="_blank" rel="noreferrer">TAGS.md</a>.
        </p>
        ${paramsHtml()}
      </section>

      <section class="about-section about-section-details" id="details">
        <h2>Details</h2>
        <div class="about-details">${details}</div>
      </section>

      <section class="about-section about-close" id="involve">
        <h2>Get involved</h2>
        <p class="about-section-lede">Follow updates. Questions and corrections belong in the open.</p>
        <div class="about-close-links">${pleblySocialAccountsHtml()}</div>
      </section>
    </section>
  `);
}
