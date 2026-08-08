import { authFetch } from "./auth";
import { WORKERS_API } from "./config";
import { sanitizePublicError } from "./public-errors";

const API = () => WORKERS_API.replace(/\/$/, "");
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type CoverUploadResult = {
  url: string;
  key: string;
  content_type: string;
  bytes: number;
};

/** Only allow https: image URLs for rendering (blocks javascript: etc.). */
export function safeHttpsImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = String(url).trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

export function clientCoverPrecheck(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    return "Cover must be JPEG, PNG, or WebP";
  }
  if (file.size > MAX_BYTES) {
    return `Cover must be under ${MAX_BYTES / (1024 * 1024)} MiB`;
  }
  return null;
}

export async function uploadProjectCover(file: File): Promise<CoverUploadResult> {
  if (!WORKERS_API) throw new Error("API not configured");
  const pre = clientCoverPrecheck(file);
  if (pre) throw new Error(pre);

  const body = new FormData();
  body.append("file", file);

  let res: Response;
  try {
    res = await authFetch(`${API()}/media/upload`, {
      method: "POST",
      body,
    });
  } catch {
    throw new Error("Could not reach the API to upload the cover.");
  }

  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    key?: string;
    content_type?: string;
    bytes?: number;
    error?: string;
    hint?: string;
  };

  if (res.status === 501) {
    const err = new Error(
      sanitizePublicError(
        data.hint || data.error || "",
        "Cover uploads are not available yet.",
      ),
    ) as Error & { code?: string };
    err.code = "MEDIA_DISABLED";
    throw err;
  }
  if (!res.ok) {
    throw new Error(data.error || `Upload failed (HTTP ${res.status})`);
  }
  if (!data.url) throw new Error("Upload succeeded but no URL returned");
  return {
    url: data.url,
    key: data.key || "",
    content_type: data.content_type || file.type,
    bytes: data.bytes ?? file.size,
  };
}
