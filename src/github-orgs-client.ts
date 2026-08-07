/**
 * Client helpers for Account-linked GitHub org attestations (apply + propose).
 */
import type { GithubOrgAttestation } from "./types";

export const ORG_ATTESTATION_MS = 90 * 86_400_000;

export function freshLinkedOrgs(user: {
  id?: string;
  github_orgs?: GithubOrgAttestation[];
} | null): GithubOrgAttestation[] {
  if (!user?.id?.startsWith("github:") || !user.github_orgs?.length) return [];
  const now = Date.now();
  return user.github_orgs.filter((o) => {
    const at = Date.parse(o.verified_at);
    return o.role === "admin" && Number.isFinite(at) && now - at <= ORG_ATTESTATION_MS;
  });
}

export function isFreshLinkedOrgAdmin(
  user: {
    id?: string;
    github_orgs?: GithubOrgAttestation[];
  } | null,
  orgLogin: string,
): boolean {
  const want = orgLogin.replace(/^@/, "").trim().toLowerCase();
  if (!want) return false;
  return freshLinkedOrgs(user).some(
    (o) => o.login.replace(/^@/, "").trim().toLowerCase() === want,
  );
}

export function orgLoginLabel(login: string): string {
  return login.replace(/^@/, "").trim();
}

/** Home / browse card “by …” line (org → /org/:login). */
export function projectCardProposerHtml(
  p: {
    proposer?: {
      username?: string | null;
      github?: string | null;
    } | null;
    proposer_type?: string | null;
  },
  opts: {
    profileHref: (username: string) => string;
    orgHref: (login: string) => string;
    escapeHtml: (s: string) => string;
    orgAvatarSlotHtml?: (login: string) => string;
  },
): string {
  const isOrg = String(p.proposer_type || "").toLowerCase() === "org";
  const github = p.proposer?.github?.trim() || "";
  if (isOrg && github) {
    const avatar = opts.orgAvatarSlotHtml
      ? opts.orgAvatarSlotHtml(github)
      : "";
    return `<a class="project-card-by" href="${opts.orgHref(github)}">${avatar}<span class="project-card-by-text">by ${opts.escapeHtml(github)}</span></a>`;
  }
  const proposerName = p.proposer?.username || p.proposer?.github || "";
  const proposerUsername = p.proposer?.username?.trim().toLowerCase() || "";
  const proposerAvatar = proposerUsername
    ? `<span class="user-avatar-slot" data-avatar-user="${opts.escapeHtml(proposerUsername)}" hidden></span>`
    : "";
  if (!proposerName) return "";
  if (p.proposer?.username) {
    return `<a class="project-card-by" href="${opts.profileHref(p.proposer.username)}">${proposerAvatar}<span class="project-card-by-text">by ${opts.escapeHtml(proposerName)}</span></a>`;
  }
  return `<span class="project-card-by"><span class="project-card-by-text">by ${opts.escapeHtml(proposerName)}</span></span>`;
}
