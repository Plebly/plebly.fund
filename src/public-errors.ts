/** Drop infra/ops wording before showing API errors on the public site. */
const INTERNAL_PATTERNS = [
  /\bworkers?\b/i,
  /wrangler/i,
  /plebly-api/i,
  /github_app/i,
  /GITHUB_/,
  /\bKV\b/,
  /not configured/i,
  /need a deploy/i,
  /pending_keyholders/i,
  /ESCROW_ADDRESS_MAP/i,
  /ESCROW_DESCRIPTOR/i,
  /TEST_ESCROW/i,
  /\bsecret/i,
  /\b501\b/,
  /GitHub org fetch failed/i,
  /GitHub denied/i,
  /App needs Organization permissions/i,
  /rate limit or App/i,
  /human publish/i,
  /npm run deploy/i,
  /Sparrow from the published/i,
  /Derive the next receive/i,
  /API not configured/i,
  /MEDIA R2/i,
  /HOOK_SECRET/i,
  /ANTHROPIC_API_KEY/i,
  /SUBMISSION_FEE_ADDRESS/i,
  /operate this site/i,
  /Set GITHUB_APP/i,
  /Organization permissions/i,
];

export function sanitizePublicError(
  raw: string,
  fallback = "Something went wrong. Try again in a few minutes.",
): string {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  if (INTERNAL_PATTERNS.some((re) => re.test(text))) return fallback;
  return text;
}
