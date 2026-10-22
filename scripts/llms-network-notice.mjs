/**
 * Network notice for public/llms.txt and public/llms-full.txt.
 *
 * On a signet build both files say up front that listings are signet test
 * listings. On mainnet (and testnet) builds the notice is removed, so a
 * committed or previously generated signet copy never leaks into mainnet.
 */

export const LLMS_SIGNET_NOTICE =
  "**Test network (signet):** This Plebly build runs on Bitcoin signet. Every listed project is a signet test listing funded with test coins that have no value, not a live mainnet project. Escrow addresses are signet (tb1) addresses, and listings share one test escrow.";

export function isSignetNetwork(network) {
  return String(network || "").toLowerCase() === "signet";
}

function stripNotice(text) {
  return text.split(`${LLMS_SIGNET_NOTICE}\n\n`).join("");
}

/**
 * llms.txt: insert after the llmstxt.org summary blockquote.
 * llms-full.txt: insert after the H1 title.
 */
export function withNetworkNotice(text, network, kind = "llms") {
  const clean = stripNotice(text);
  if (!isSignetNetwork(network)) return clean;
  const lines = clean.split("\n");
  const anchor =
    kind === "llms"
      ? lines.findIndex((l) => l.startsWith("> "))
      : lines.findIndex((l) => l.startsWith("# "));
  if (anchor < 0) return `${LLMS_SIGNET_NOTICE}\n\n${clean}`;
  // Skip the blank line after the anchor so the notice is its own paragraph.
  const at = lines[anchor + 1] === "" ? anchor + 2 : anchor + 1;
  lines.splice(at, 0, LLMS_SIGNET_NOTICE, "");
  return lines.join("\n");
}
