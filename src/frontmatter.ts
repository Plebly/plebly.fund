/**
 * Minimal frontmatter parser with nested maps / list-of-maps support
 * (enough for proposer + milestones YAML used in Plebly/proposals).
 */

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "[]") return [];
  if (value === "{}") return {};
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith("{") || value.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      /* fall through */
    }
  }
  return value;
}

function indentOf(line: string): number {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

type Frame =
  | {
      kind: "map";
      indent: number;
      map: Record<string, unknown>;
      openKey?: string;
      openKeyIndent?: number;
    }
  | {
      kind: "list";
      indent: number;
      list: unknown[];
    };

export function parseYamlFrontMatter(fm: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Frame[] = [{ kind: "map", indent: -1, map: root }];

  for (const rawLine of fm.replace(/\r\n/g, "\n").split("\n")) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indent = indentOf(rawLine);
    const line = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop();
    }

    const frame = stack[stack.length - 1]!;

    if (line.startsWith("- ")) {
      const itemBody = line.slice(2).trim();
      let listFrame: Extract<Frame, { kind: "list" }>;

      if (frame.kind === "list") {
        listFrame = frame;
      } else if (frame.openKey != null && frame.openKeyIndent != null) {
        const list: unknown[] = [];
        frame.map[frame.openKey] = list;
        const listIndent = frame.openKeyIndent;
        frame.openKey = undefined;
        frame.openKeyIndent = undefined;
        listFrame = { kind: "list", indent: listIndent, list };
        stack.push(listFrame);
      } else {
        continue;
      }

      const colon = itemBody.indexOf(":");
      if (
        colon > 0 &&
        !itemBody.startsWith("{") &&
        !itemBody.startsWith("[")
      ) {
        const k = itemBody.slice(0, colon).trim();
        const vRaw = itemBody.slice(colon + 1).trim();
        const obj: Record<string, unknown> = {};
        listFrame.list.push(obj);
        if (vRaw === "") {
          stack.push({
            kind: "map",
            indent,
            map: obj,
            openKey: k,
            openKeyIndent: indent,
          });
        } else {
          obj[k] = parseScalar(vRaw);
          stack.push({ kind: "map", indent, map: obj });
        }
      } else {
        listFrame.list.push(parseScalar(itemBody));
      }
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const vRaw = line.slice(colon + 1).trim();

    if (frame.kind === "list") {
      const last = frame.list[frame.list.length - 1];
      if (!last || typeof last !== "object" || Array.isArray(last)) continue;
      const obj = last as Record<string, unknown>;
      if (vRaw === "") {
        const nested: Record<string, unknown> = {};
        obj[key] = nested;
        stack.push({ kind: "map", indent, map: nested });
      } else {
        obj[key] = parseScalar(vRaw);
      }
      continue;
    }

    // First child of an open key → open nested map
    if (
      frame.openKey != null &&
      frame.openKeyIndent != null &&
      indent > frame.openKeyIndent
    ) {
      const nested: Record<string, unknown> = {};
      const nestIndent = frame.openKeyIndent;
      frame.map[frame.openKey] = nested;
      frame.openKey = undefined;
      frame.openKeyIndent = undefined;
      stack.push({ kind: "map", indent: nestIndent, map: nested });
      const nestedFrame = stack[stack.length - 1] as Extract<
        Frame,
        { kind: "map" }
      >;
      if (vRaw === "") {
        nestedFrame.openKey = key;
        nestedFrame.openKeyIndent = indent;
      } else {
        nestedFrame.map[key] = parseScalar(vRaw);
      }
      continue;
    }

    if (vRaw === "") {
      frame.openKey = key;
      frame.openKeyIndent = indent;
      continue;
    }

    frame.map[key] = parseScalar(vRaw);
    frame.openKey = undefined;
    frame.openKeyIndent = undefined;
  }

  return root;
}

export function parseFrontMatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const fm = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).trim();
  return { data: parseYamlFrontMatter(fm), body };
}

/** Lowercased ## section title → body text. */
export function extractBodySections(body: string): Record<string, string> {
  const text = body.replace(/^\s*#[^\n]*\n?/, "").trim();
  const sections: Record<string, string> = {};
  const re = /^##\s+(.+)$/gm;
  const matches = [...text.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i]![1]!.trim().toLowerCase();
    const start = matches[i]!.index! + matches[i]![0]!.length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    sections[title] = text.slice(start, end).trim();
  }
  return sections;
}
