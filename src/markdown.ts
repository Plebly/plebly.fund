import createDOMPurify, { type DOMPurify as DomPurifyInstance } from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true });

function isSafeHttpUrl(href: string): boolean {
  try {
    const u = new URL(href, "https://plebly.fund");
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeAttr(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!href || !isSafeHttpUrl(href)) {
        return text;
      }
      const t = title ? ` title="${escapeAttr(title)}"` : "";
      return `<a href="${escapeAttr(href)}"${t} target="_blank" rel="noreferrer noopener">${text}</a>`;
    },
  },
});

let purify: DomPurifyInstance | null = null;

function getPurify(): DomPurifyInstance {
  if (purify) return purify;
  // happy-dom / browser window — cast for DOMPurify's WindowLike
  const root = (typeof globalThis.window !== "undefined"
    ? globalThis.window
    : globalThis) as unknown as Parameters<typeof createDOMPurify>[0];
  purify = createDOMPurify(root);
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    if (node.hasAttribute("href")) {
      const href = node.getAttribute("href") || "";
      if (!isSafeHttpUrl(href)) {
        node.removeAttribute("href");
      } else {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noreferrer noopener");
      }
    }
    if (node.hasAttribute("src")) {
      const src = node.getAttribute("src") || "";
      if (!isSafeHttpUrl(src)) {
        node.removeAttribute("src");
      }
    }
  });
  return purify;
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "a",
    "p",
    "br",
    "hr",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "b",
    "i",
    "code",
    "pre",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "del",
    "ins",
    "sup",
    "sub",
  ],
  ALLOWED_ATTR: [
    "href",
    "title",
    "target",
    "rel",
    "src",
    "alt",
    "width",
    "height",
    "class",
  ],
  ALLOW_DATA_ATTR: false,
};

/** Last-resort strip if DOMPurify cannot bind a DOM (should not happen in SPA). */
function stripUnsafeHrefs(html: string): string {
  return html.replace(
    /\s(href|src)\s*=\s*(["'])(?!https?:)[^"']*\2/gi,
    "",
  );
}

export function renderMarkdown(markdown: string): string {
  if (!markdown.trim()) return "";
  const raw = marked.parse(markdown, { async: false }) as string;
  try {
    const cleaned = getPurify().sanitize(raw, PURIFY_CONFIG);
    return stripUnsafeHrefs(cleaned);
  } catch {
    return stripUnsafeHrefs(
      raw
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ""),
    );
  }
}
