import { PROPOSALS_API, PROPOSALS_RAW } from "./config";
import type { Proposal } from "./types";

type GhContent = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
};

function parseFrontMatter(raw: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const fm = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).trim();
  const data: Record<string, unknown> = {};
  for (const line of fm.split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let value: unknown = line.slice(i + 1).trim();
    if (value === "null") value = null;
    else if (value === "[]") value = [];
    else if (
      typeof value === "string" &&
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
      value = value.slice(1, -1);
    } else if (typeof value === "string" && /^-?\d+$/.test(value)) {
      value = Number(value);
    }
    data[key] = value;
  }
  return { data, body };
}

export async function listListedProposals(): Promise<Proposal[]> {
  const dirs = ["listed", "claimed", "completed"];
  const out: Proposal[] = [];
  for (const dir of dirs) {
    const res = await fetch(`${PROPOSALS_API}/${dir}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const items = (await res.json()) as GhContent[];
    for (const item of items) {
      if (item.type !== "file" || !item.name.endsWith(".md")) continue;
      const rawRes = await fetch(`${PROPOSALS_RAW}/${item.path}`);
      if (!rawRes.ok) continue;
      const raw = await rawRes.text();
      const { data, body } = parseFrontMatter(raw);
      out.push({
        id: (data.id as string) || item.name.replace(/\.md$/, ""),
        title: (data.title as string) || item.name,
        status: (data.status as string) || dir,
        path: item.path,
        target_sats:
          typeof data.target_sats === "number" ? data.target_sats : null,
        escrow_address: (data.escrow_address as string) || null,
        submission_fee_txid: (data.submission_fee_txid as string) || null,
        body,
      });
    }
  }
  return out;
}

export async function fetchParametersMarkdown(): Promise<string> {
  const res = await fetch(`${PROPOSALS_RAW}/PARAMETERS.md`);
  if (!res.ok) return "";
  return res.text();
}
