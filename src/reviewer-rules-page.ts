import rulesMarkdown from "../content/reviewer-responsibilities.md?raw";
import { href, projectsHref } from "./router";
import { renderMarkdown } from "./markdown";

export type ReviewerRulesShell = (inner: string) => string;

export function reviewerRulesBodyMarkdown(
  raw: string = rulesMarkdown,
): string {
  return raw.replace(/^#\s+.+\n+/, "").trim();
}

export function reviewerRulesPageHtml(markdown = rulesMarkdown): string {
  const body = reviewerRulesBodyMarkdown(markdown);
  return `<section class="wrap-wide detail">
      <header class="declined-head">
        <p class="eyebrow"><a href="${href("/reviewers")}">Reviewers</a></p>
        <h1>Reviewer rules</h1>
        <p class="lede">Who can review, how a vote passes, and what stays on the project page.</p>
      </header>
      <div class="prose-rich">${renderMarkdown(body)}</div>
      <p class="muted"><a href="${href("/reviewers")}">Roster</a> · <a href="${href("/keyholder-responsibilities")}">Keyholder responsibilities</a> · <a href="${href("/terms")}">Terms</a> · <a href="${projectsHref()}">Projects</a></p>
    </section>`;
}

export function renderReviewerRules(shell: ReviewerRulesShell): void {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(reviewerRulesPageHtml());
}
