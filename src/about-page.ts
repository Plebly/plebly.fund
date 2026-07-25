import {
  ABOUT_BELIEFS,
  ABOUT_BITCOIN_NETWORK,
  ABOUT_BUILDERS_HTML,
  ABOUT_INTRO_HTML,
  ABOUT_LIGHTNING_HTML,
  ABOUT_PARAM_LABELS,
  ABOUT_STEPS,
} from "./generated/about-data";
import { pleblySocialAccountsHtml } from "./icons";
import { href } from "./router";
import { escapeHtml } from "./util";

export type AboutShell = (inner: string) => string;

const BELIEF_ICONS = ["shield", "git", "rules"] as const;

function beliefCardsHtml(): string {
  if (!ABOUT_BELIEFS.length) return "";
  return `<div class="value-cards">${ABOUT_BELIEFS.map((b, i) => {
    const icon = BELIEF_ICONS[i] ?? "shield";
    return `<article class="value-card">
      <span class="value-icon value-icon-${icon}" aria-hidden="true"></span>
      <h3>${escapeHtml(b.title)}</h3>
      <p>${b.body}</p>
    </article>`;
  }).join("")}</div>`;
}

function processStepsHtml(): string {
  if (!ABOUT_STEPS.length) return "";
  return `<ol class="process-steps">${ABOUT_STEPS.map(
    (s) => `<li>
      <span class="process-step-title">${escapeHtml(s.title)}</span>
      <span class="process-step-body">${escapeHtml(s.body)}</span>
    </li>`,
  ).join("")}</ol>`;
}

function paramGridHtml(): string {
  return `<div class="param-grid">${ABOUT_PARAM_LABELS.map(
    (p) => `<article class="param-card">
      <span class="param-label">${escapeHtml(p.label)}</span>
      <span class="param-value">${escapeHtml(p.value)}</span>
      <span class="param-hint">${escapeHtml(p.hint)}</span>
    </article>`,
  ).join("")}</div>`;
}

function networkBannerHtml(): string {
  if (ABOUT_BITCOIN_NETWORK !== "signet") return "";
  return `<div class="network-banner">
    <span class="network-banner-k">Testing</span>
    <p>This deployment runs on <strong>signet</strong> for end-to-end testing. Launch will use <strong>mainnet only</strong> with 3-of-5 multisig escrow.</p>
    <a href="https://github.com/Plebly/proposals/blob/main/KEYHOLDERS.md" target="_blank" rel="noreferrer">Keyholders →</a>
  </div>`;
}

export function renderAbout(shell: AboutShell): void {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="wrap-wide detail about-page">
      <header class="about-hero">
        <p class="about-eyebrow">About</p>
        <h1>Plebly</h1>
        <div class="about-lede prose-rich">${ABOUT_INTRO_HTML}</div>
      </header>

      <section class="about-block" id="beliefs">
        <h2 class="about-block-title">What we believe</h2>
        ${beliefCardsHtml()}
      </section>

      <section class="about-block" id="how-it-works">
        <h2 class="about-block-title">How it works</h2>
        ${processStepsHtml()}
        <p class="about-links">
          Browse <a href="${href("/")}">open projects</a>,
          <a href="${href("/propose")}">start a project</a>, or read the full rules in the
          <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">proposals repo</a>.
        </p>
      </section>

      ${
        ABOUT_BUILDERS_HTML
          ? `<section class="about-block" id="builders">
        <h2 class="about-block-title">For builders</h2>
        <div class="about-prose prose-rich">${ABOUT_BUILDERS_HTML}</div>
      </section>`
          : ""
      }

      ${
        ABOUT_LIGHTNING_HTML
          ? `<section class="about-block" id="lightning">
        <h2 class="about-block-title">Lightning donations</h2>
        <div class="about-prose prose-rich">${ABOUT_LIGHTNING_HTML}</div>
      </section>`
          : ""
      }

      <section class="about-block" id="parameters">
        <h2 class="about-block-title">Key parameters</h2>
        <p class="about-block-lede">Fixed at launch and pulled from
          <a href="https://github.com/Plebly/proposals/blob/main/PARAMETERS.md" target="_blank" rel="noreferrer">PARAMETERS.md</a>
          on every deploy.</p>
        ${paramGridHtml()}
      </section>

      ${networkBannerHtml()}

      <section class="about-block" id="residual-trust">
        <h2 class="about-block-title">Residual trust</h2>
        <p class="about-block-lede">
          Escrow is 3-of-5 multisig with no on-chain timelock in v1. If keyholders stall after a
          reviewer-approved release, the public process in
          <a href="https://github.com/Plebly/proposals/blob/main/docs/keyholder-stall-runbook.md" target="_blank" rel="noreferrer">KEYHOLDERS stall runbook</a>
          applies (7-day log / 14-day incident). See
          <a href="https://github.com/Plebly/proposals/blob/main/PARAMETERS.md" target="_blank" rel="noreferrer">PARAMETERS</a>.
        </p>
      </section>

      <section class="about-involve">
        <h2 class="about-block-title">Get involved</h2>
        <p>Follow updates and send questions, proposals, and corrections in the open.</p>
        <div class="about-involve-links">${pleblySocialAccountsHtml()}</div>
      </section>
    </section>
  `);
}
