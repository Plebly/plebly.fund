import { authFetch } from "./auth";
import { WORKERS_API } from "./config";

/**
 * Who-am-I for the platform admin desk. Kept out of `admin-page` so the nav
 * check on every page does not pull the admin desk into the entry chunk.
 */
export async function fetchAdminMe(): Promise<{
  admin: boolean;
  github?: string | null;
  error?: string;
}> {
  if (!WORKERS_API) return { admin: false };
  try {
    const res = await authFetch(`${WORKERS_API.replace(/\/$/, "")}/admin/me`);
    return (await res.json()) as { admin: boolean; github?: string; error?: string };
  } catch {
    return { admin: false };
  }
}
