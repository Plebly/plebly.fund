/** Same text the worker verifies. A campaign has no id yet, so the message names the address only. */
export function payToSignMessage(address: string, proposalId?: string): string {
  const addr = address.trim().toLowerCase();
  if (!addr) return "";
  if (proposalId) return `plebly-pay-to|v1|plebly.fund|${proposalId}|${addr}`;
  return `plebly-pay-to|v1|plebly.fund|${addr}`;
}
