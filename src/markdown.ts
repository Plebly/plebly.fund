import { marked } from "marked";

marked.setOptions({ gfm: true });

marked.use({
  renderer: {
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const t = title ? ` title="${title}"` : "";
      return `<a href="${href}"${t} target="_blank" rel="noreferrer noopener">${text}</a>`;
    },
  },
});

export function renderMarkdown(markdown: string): string {
  if (!markdown.trim()) return "";
  return marked.parse(markdown, { async: false }) as string;
}
