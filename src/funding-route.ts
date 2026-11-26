import { WORKERS_API } from "./config";

export const DIRECT_SITE_DESCRIPTION =
  "Fund open Bitcoin work. New listings pay the builder. That payment is final. Plebly's server holds no keys.";

export const ESCROW_SITE_DESCRIPTION =
  "Fund open Bitcoin work with publicly verifiable on-chain escrow. Plebly's server holds no keys.";

/** New listings use multisig only when /parameters says so. Unknown stays direct. */
export function platformUsesEscrow(route: string | null | undefined): boolean {
  return route === "multisig";
}

let cached: "multisig" | "direct-builder" | null = null;
let pending: Promise<"multisig" | "direct-builder"> | null = null;

export function escrowListingsOn(): boolean {
  return cached === "multisig";
}

export function siteDescription(): string {
  return escrowListingsOn() ? ESCROW_SITE_DESCRIPTION : DIRECT_SITE_DESCRIPTION;
}

export function clearFundingRouteCache(): void {
  cached = null;
  pending = null;
}

export async function loadFundingRoute(): Promise<"multisig" | "direct-builder"> {
  if (cached) return cached;
  if (!pending) {
    pending = (async () => {
      try {
        if (!WORKERS_API) return "direct-builder" as const;
        const res = await fetch(`${WORKERS_API.replace(/\/$/, "")}/parameters`);
        if (!res.ok) return "direct-builder" as const;
        const data = (await res.json()) as { funding_route?: string };
        return data.funding_route === "multisig"
          ? ("multisig" as const)
          : ("direct-builder" as const);
      } catch {
        return "direct-builder" as const;
      }
    })().then((route) => {
      cached = route;
      return route;
    });
  }
  return pending;
}
