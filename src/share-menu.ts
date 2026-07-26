import {
  btnBrandIconOnly,
  btnWithIcon,
  solidIcon,
} from "./icons";
import { escapeHtml } from "./util";

export type SharePayload = {
  title: string;
  text: string;
  url: string;
};

export function shareDestinations(payload: SharePayload): {
  x: string;
  reddit: string;
  hn: string;
} {
  const { text, url } = payload;
  return {
    x: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
    hn: `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(url)}&t=${encodeURIComponent(text)}`,
  };
}

/** True when the OS share sheet is likely to work (phones / tablets). */
export function prefersNativeShare(): boolean {
  if (typeof navigator.share !== "function") return false;
  try {
    if (
      typeof navigator.canShare === "function" &&
      !navigator.canShare({ url: location.href, title: "Plebly" })
    ) {
      return false;
    }
  } catch {
    return false;
  }
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * Desktop share sheet: copy + social destinations.
 * Closes on backdrop / Escape / after copy.
 */
export function openShareMenu(payload: SharePayload): Promise<void> {
  const dest = shareDestinations(payload);
  const root = document.createElement("div");
  root.className = "site-modal share-menu-modal";
  root.setAttribute("role", "presentation");
  root.innerHTML = `
    <div class="site-modal-backdrop" data-share-close tabindex="-1" aria-hidden="true"></div>
    <div class="site-modal-card share-menu-card" role="dialog" aria-modal="true" aria-labelledby="share-menu-title">
      <button type="button" class="site-modal-close" data-share-close aria-label="Close">${solidIcon("xmark")}</button>
      <h2 id="share-menu-title">Share</h2>
      <p class="muted share-menu-url mono" title="${escapeHtml(payload.url)}">${escapeHtml(payload.url)}</p>
      <div class="share-menu-actions">
        <button type="button" class="btn ghost share-menu-copy" data-share-copy>${btnWithIcon("link", "Copy link")}</button>
        <div class="share-menu-social">
          <a class="btn ghost proposal-share-icon" href="${escapeHtml(dest.x)}" target="_blank" rel="noreferrer noopener" aria-label="Share on X" title="Share on X">${btnBrandIconOnly("x-twitter")}</a>
          <a class="btn ghost proposal-share-icon" href="${escapeHtml(dest.reddit)}" target="_blank" rel="noreferrer noopener" aria-label="Share on Reddit" title="Share on Reddit">${btnBrandIconOnly("reddit")}</a>
          <a class="btn ghost proposal-share-icon" href="${escapeHtml(dest.hn)}" target="_blank" rel="noreferrer noopener" aria-label="Share on Hacker News" title="Share on Hacker News">${btnBrandIconOnly("hacker-news")}</a>
        </div>
      </div>
    </div>
  `;

  return new Promise((resolve) => {
    const finish = () => {
      document.removeEventListener("keydown", onKey);
      root.remove();
      resolve();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish();
      }
    };

    root.querySelectorAll("[data-share-close]").forEach((el) => {
      el.addEventListener("click", finish);
    });
    root.querySelectorAll("a[href]").forEach((el) => {
      el.addEventListener("click", () => {
        // Let the new tab open, then close the sheet.
        setTimeout(finish, 0);
      });
    });
    root
      .querySelector<HTMLButtonElement>("[data-share-copy]")
      ?.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const btn = ev.currentTarget as HTMLButtonElement;
        try {
          await navigator.clipboard.writeText(payload.url);
          const label = btn.querySelector(".btn-icon > span:last-child");
          if (label) {
            const prev = label.textContent;
            label.textContent = "Copied";
            setTimeout(() => {
              if (prev) label.textContent = prev;
              finish();
            }, 700);
          } else {
            finish();
          }
        } catch {
          window.alert("Could not copy link");
        }
      });

    document.addEventListener("keydown", onKey);
    document.body.appendChild(root);
    root.querySelector<HTMLButtonElement>("[data-share-copy]")?.focus();
  });
}
