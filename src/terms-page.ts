import { href, projectsHref } from "./router";
import { renderMarkdown } from "./markdown";
import { tosDisplayMarkdown } from "./tos";

export type TermsShell = (inner: string) => string;

export async function renderTerms(shell: TermsShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(`
    <section class="wrap-wide detail">
      <p class="loading">Loading terms…</p>
    </section>
  `);
  const res = await fetch(href("/docs/TOS.md")).catch(() => null);
  const markdown = res?.ok ? tosDisplayMarkdown(await res.text()) : "";
  const body = markdown
    ? `<div class="prose-rich">${renderMarkdown(markdown)}</div>`
    : `<p class="muted">Terms could not be loaded. They are published on this site at /terms.</p>`;
  app.innerHTML = shell(`
    <section class="wrap-wide detail">
      <header class="declined-head">
        <p class="eyebrow"><a href="${href("/about")}">About</a></p>
        <h1>Terms</h1>
        <p class="lede">Rules for proposing and claiming on Plebly.</p>
      </header>
      ${body}
      <p class="muted"><a href="${href("/parameters")}">Parameters</a> · <a href="${projectsHref()}">Projects</a></p>
    </section>
  `);
}
