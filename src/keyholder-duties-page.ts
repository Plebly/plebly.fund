import dutiesMarkdown from "../content/keyholder-responsibilities.md?raw";
import { loadFundingRoute } from "./funding-route";
import { href, projectsHref } from "./router";
import { renderMarkdown } from "./markdown";

export type DutiesShell = (inner: string) => string;

export function dutiesBodyMarkdown(raw: string = dutiesMarkdown): string {
  return raw.replace(/^#\s+.+\n+/, "").trim();
}

export function keyholderDutiesPageHtml(
  markdown = dutiesMarkdown,
  escrowOn = true,
): string {
  if (!escrowOn) {
    return `<section class="wrap-wide detail">
      <header class="declined-head">
        <h1>Keyholder responsibilities</h1>
        <p class="lede">New listings pay the builder. Keyholder applications are closed.</p>
      </header>
      <p class="muted">A listing that already has an escrow keeps its keyholders.</p>
      <p class="muted"><a href="${href("/reviewer-responsibilities")}">Reviewer rules</a> · <a href="${href("/terms")}">Terms</a> · <a href="${projectsHref()}">Projects</a></p>
    </section>`;
  }
  const body = dutiesBodyMarkdown(markdown);
  return `<section class="wrap-wide detail">
      <header class="declined-head">
        <p class="eyebrow"><a href="${href("/keyholders")}">Keyholders</a></p>
        <h1>Keyholder responsibilities</h1>
        <p class="lede">What a keyholder does, how they are paid, and what happens if they stall.</p>
      </header>
      <div class="prose-rich">${renderMarkdown(body)}</div>
      <p class="muted"><a href="${href("/keyholders")}">Apply</a> · <a href="${href("/reviewer-responsibilities")}">Reviewer rules</a> · <a href="${href("/terms")}">Terms</a> · <a href="${href("/parameters")}">Parameters</a> · <a href="${projectsHref()}">Projects</a></p>
    </section>`;
}

export async function renderKeyholderDuties(shell: DutiesShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  const escrowOn = (await loadFundingRoute()) === "multisig";
  app.innerHTML = shell(keyholderDutiesPageHtml(dutiesMarkdown, escrowOn));
}
