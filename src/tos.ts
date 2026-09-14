export const TOS_CURRENT = {
  version: "tos-2026-09-13",
  published_at: "2026-09-13T00:00:00.000Z",
} as const;

export const TOS_PREVIOUS: { version: string } | null = {
  version: "tos-2026-08-13",
};
export const TOS_GRACE_DAYS = 30;

export type TosStatus = "current" | "grace" | "required";

export function tosStatus(
  profile: { tos_version?: string } | null | undefined,
  now: number = Date.now(),
): TosStatus {
  const version = profile?.tos_version?.trim() || "";
  if (version === TOS_CURRENT.version) return "current";
  if (
    TOS_PREVIOUS &&
    version === TOS_PREVIOUS.version &&
    now < Date.parse(TOS_CURRENT.published_at) + TOS_GRACE_DAYS * 86400_000
  ) {
    return "grace";
  }
  return "required";
}

export function isPaidDisputeKind(kind: string): boolean {
  return (
    kind === "second_review" ||
    kind === "listing_challenge" ||
    kind === "claim_extension"
  );
}

export function reviewKindPayLabel(kind: string): string {
  if (kind === "deliverable_confirm") return "Unpaid";
  if (isPaidDisputeKind(kind)) {
    return "10,000 sats · payment not enabled yet";
  }
  return "";
}

/** Drop machine metadata so /terms does not show version keys. */
export function tosDisplayMarkdown(raw: string): string {
  return raw
    .replace(/^version:\s*\S+\s*$/gim, "")
    .replace(/^published_at:\s*\S+\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
