import { WORKERS_API } from "./config";
import { authFetch } from "./auth";
import { isStandalonePwa } from "./pwa";

function API(): string {
  return (WORKERS_API || "").replace(/\/$/, "");
}

/** Parse service-worker push JSON (kept in sync with public/sw.js). */
export function parsePushEventData(raw: string | null | undefined): {
  title: string;
  body: string;
  url: string;
  tag?: string;
} {
  if (!raw) {
    return {
      title: "Plebly",
      body: "You have a new notification.",
      url: "/account?tab=notifications",
    };
  }
  try {
    const data = JSON.parse(raw) as {
      title?: unknown;
      body?: unknown;
      url?: unknown;
      tag?: unknown;
    };
    const title =
      typeof data.title === "string" && data.title.trim()
        ? data.title.trim()
        : "Plebly";
    const body =
      typeof data.body === "string" && data.body.trim()
        ? data.body.trim()
        : "Open Plebly for details.";
    let url =
      typeof data.url === "string" && data.url.trim()
        ? data.url.trim()
        : "/account?tab=notifications";
    // Only allow same-origin relative paths or absolute https URLs we will re-scope on click.
    if (url.startsWith("http://") || url.startsWith("https://")) {
      try {
        const u = new URL(url);
        url = `${u.pathname}${u.search}${u.hash}` || "/";
      } catch {
        url = "/account?tab=notifications";
      }
    } else if (!url.startsWith("/")) {
      url = `/${url}`;
    }
    const tag = typeof data.tag === "string" ? data.tag : undefined;
    return { title, body, url, tag };
  } catch {
    return {
      title: "Plebly",
      body: "You have a new notification.",
      url: "/account?tab=notifications",
    };
  }
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Phone push is offered only from an installed (standalone) PWA. */
export function canOfferWebPush(): boolean {
  if (typeof window === "undefined") return false;
  if (!isStandalonePwa()) return false;
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window)) return false;
  if (!("Notification" in window)) return false;
  return Boolean(WORKERS_API);
}

export function webPushPanelHtml(): string {
  return `<div class="web-push-panel" id="web-push-panel" hidden>
    <p class="web-push-lede" id="web-push-lede">Get system notifications on this device while the app is closed.</p>
    <p class="form-msg" id="web-push-msg" hidden></p>
    <div class="web-push-actions">
      <button type="button" class="btn" id="web-push-enable" hidden>Enable phone alerts</button>
      <button type="button" class="btn ghost" id="web-push-disable" hidden>Turn off on this device</button>
    </div>
  </div>`;
}

function setMsg(el: HTMLElement | null, text: string, cls = "") {
  if (!el) return;
  el.hidden = !text;
  el.className = cls ? `form-msg ${cls}` : "form-msg";
  el.textContent = text;
}

async function fetchVapidPublicKey(): Promise<string | null> {
  if (!WORKERS_API) return null;
  const res = await fetch(`${API()}/notifications/push/vapid`);
  if (!res.ok) return null;
  const data = (await res.json()) as { publicKey?: string; configured?: boolean };
  return data.configured && data.publicKey ? data.publicKey : null;
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const res = await authFetch(`${API()}/notifications/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: json.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: json.keys,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Subscribe failed (${res.status})`);
  }
}

async function deleteSubscription(endpoint: string): Promise<void> {
  const res = await authFetch(`${API()}/notifications/push/subscribe`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Unsubscribe failed (${res.status})`);
  }
}

export async function enableWebPush(): Promise<void> {
  if (!canOfferWebPush()) {
    throw new Error("Install Plebly to your home screen first.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }
  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) throw new Error("Push notifications are not available yet.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        publicKey,
      ) as BufferSource,
    });
  }
  await postSubscription(sub);
}

export async function disableWebPush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  await deleteSubscription(endpoint).catch(() => undefined);
}

/** Re-sync an existing granted subscription after launch (standalone only). */
export async function syncWebPushIfEnabled(): Promise<"synced" | "skipped"> {
  if (!canOfferWebPush()) return "skipped";
  if (Notification.permission !== "granted") return "skipped";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return "skipped";
    await postSubscription(sub);
    return "synced";
  } catch {
    return "skipped";
  }
}

export async function bindWebPushPanel(root: ParentNode = document): Promise<void> {
  const panel = root.querySelector<HTMLElement>("#web-push-panel");
  if (!panel) return;
  if (!canOfferWebPush()) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const lede = root.querySelector<HTMLElement>("#web-push-lede");
  const msg = root.querySelector<HTMLElement>("#web-push-msg");
  const enableBtn = root.querySelector<HTMLButtonElement>("#web-push-enable");
  const disableBtn = root.querySelector<HTMLButtonElement>("#web-push-disable");

  const refresh = async () => {
    const permission = Notification.permission;
    let hasSub = false;
    try {
      const reg = await navigator.serviceWorker.ready;
      hasSub = Boolean(await reg.pushManager.getSubscription());
    } catch {
      hasSub = false;
    }
    if (lede) {
      lede.textContent =
        permission === "denied"
          ? "Notifications are blocked for this app. Enable them in system settings, then try again."
          : hasSub && permission === "granted"
            ? "Phone alerts are on for this device."
            : "Get system notifications on this device while the app is closed.";
    }
    if (enableBtn) {
      enableBtn.hidden = permission === "denied" || (hasSub && permission === "granted");
    }
    if (disableBtn) {
      disableBtn.hidden = !(hasSub && permission === "granted");
    }
  };

  enableBtn?.addEventListener("click", async () => {
    enableBtn.disabled = true;
    setMsg(msg, "");
    try {
      await enableWebPush();
      setMsg(msg, "Phone alerts enabled.", "success");
    } catch (e) {
      setMsg(msg, (e as Error).message, "error");
    } finally {
      enableBtn.disabled = false;
      await refresh();
    }
  });

  disableBtn?.addEventListener("click", async () => {
    disableBtn.disabled = true;
    setMsg(msg, "");
    try {
      await disableWebPush();
      setMsg(msg, "Phone alerts turned off on this device.", "success");
    } catch (e) {
      setMsg(msg, (e as Error).message, "error");
    } finally {
      disableBtn.disabled = false;
      await refresh();
    }
  });

  await refresh();
}
