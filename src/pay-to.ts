/** Same text the worker verifies. A campaign has no id yet, so the message names the address only. */
export function payToSignMessage(address: string, proposalId?: string): string {
  const addr = address.trim().toLowerCase();
  if (!addr) return "";
  if (proposalId) return `plebly-pay-to|v1|plebly.fund|${proposalId}|${addr}`;
  return `plebly-pay-to|v1|plebly.fund|${addr}`;
}

/** Same text the worker verifies. Host is lowercased; lnurl1 is lowercased. */
export function lightningPaySignMessage(destination: string, proposalId: string): string {
  const dest = destination.trim();
  const id = proposalId.trim();
  if (!dest || !id) return "";
  const normalized = /^lnurl1/i.test(dest)
    ? dest.toLowerCase()
    : dest.includes("@")
      ? `${dest.slice(0, dest.lastIndexOf("@"))}@${dest.slice(dest.lastIndexOf("@") + 1).toLowerCase()}`
      : dest.toLowerCase();
  return `plebly-ln|v1|plebly.fund|${id}|${normalized}`;
}
