import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("./auth", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock("./config", () => ({ WORKERS_API: "https://api.test/" }));

import {
  avatarImgHtml,
  clientCoverPrecheck,
  safeCoverImageUrl,
  safeHttpsImageUrl,
  uploadProjectCover,
} from "./media";

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type });

describe("safeHttpsImageUrl", () => {
  it("accepts https URLs and normalises them", () => {
    expect(safeHttpsImageUrl(" https://img.example/a.png ")).toBe("https://img.example/a.png");
  });

  it("resolves relative paths against the Workers API", () => {
    expect(safeHttpsImageUrl("/media/avatars/x.png")).toBe("https://api.test/media/avatars/x.png");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:image/png;base64,AAAA",
    "http://img.example/a.png",
    "ftp://img.example/a.png",
    "//",
  ])("rejects %s", (u) => {
    expect(safeHttpsImageUrl(u)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(safeHttpsImageUrl(null)).toBeNull();
    expect(safeHttpsImageUrl(undefined)).toBeNull();
    expect(safeHttpsImageUrl("   ")).toBeNull();
  });
});

describe("safeCoverImageUrl", () => {
  it("accepts only API-origin /media/covers/ URLs", () => {
    expect(safeCoverImageUrl("https://api.test/media/covers/u/a.jpg")).toBe(
      "https://api.test/media/covers/u/a.jpg",
    );
    expect(safeCoverImageUrl("/media/covers/u/a.jpg")).toBe("https://api.test/media/covers/u/a.jpg");
    expect(safeCoverImageUrl("https://api.test/media/avatars/a.jpg")).toBeNull();
    expect(safeCoverImageUrl("https://api.test.evil/media/covers/a.jpg")).toBeNull();
  });
});

describe("avatarImgHtml", () => {
  it("renders a lazy, sized, alt-less img for a safe URL", () => {
    expect(avatarImgHtml("https://img.example/a.png", "avatar", 32)).toBe(
      '<img class="avatar" src="https://img.example/a.png" alt="" width="32" height="32" loading="lazy" decoding="async" />',
    );
  });

  it("cannot break out of the src attribute", () => {
    const out = avatarImgHtml('https://img.example/a.png?x="><script>', "a", 16);
    expect(out).not.toContain("<script>");
    expect(out).not.toMatch(/src="[^"]*"[^ ]/);
  });

  it("HTML-escapes the src attribute", () => {
    expect(avatarImgHtml("https://img.example/a.png?a=1&b=2", "a", 16)).toContain(
      'src="https://img.example/a.png?a=1&amp;b=2"',
    );
  });

  it("renders nothing for unsafe or missing URLs", () => {
    expect(avatarImgHtml("javascript:alert(1)", "a", 16)).toBe("");
    expect(avatarImgHtml(null, "a", 16)).toBe("");
  });
});

describe("clientCoverPrecheck", () => {
  it("accepts JPEG, PNG and WebP by MIME type or extension", () => {
    expect(clientCoverPrecheck(file("a.bin", "image/jpeg"))).toBeNull();
    expect(clientCoverPrecheck(file("a.bin", "image/png"))).toBeNull();
    expect(clientCoverPrecheck(file("a.bin", "image/webp"))).toBeNull();
    expect(clientCoverPrecheck(file("A.JPEG", ""))).toBeNull();
    expect(clientCoverPrecheck(file("a.webp", "application/octet-stream"))).toBeNull();
  });

  it("rejects other types", () => {
    expect(clientCoverPrecheck(file("a.gif", "image/gif"))).toMatch(/JPEG, PNG, or WebP/);
    expect(clientCoverPrecheck(file("a.svg", "image/svg+xml"))).toMatch(/JPEG, PNG, or WebP/);
    expect(clientCoverPrecheck(file("a.png.exe", ""))).toMatch(/JPEG, PNG, or WebP/);
  });

  it("enforces the 2 MiB cap inclusively", () => {
    expect(clientCoverPrecheck(file("a.png", "image/png", 2 * 1024 * 1024))).toBeNull();
    expect(clientCoverPrecheck(file("a.png", "image/png", 2 * 1024 * 1024 + 1))).toBe(
      "Cover must be under 2 MiB",
    );
  });
});

describe("uploadProjectCover", () => {
  beforeEach(() => authFetch.mockReset());

  it("POSTs multipart to /media/upload and fills defaults from the file", async () => {
    authFetch.mockResolvedValue(new Response(JSON.stringify({ url: "https://api.test/media/covers/k.png" })));
    const f = file("c.png", "image/png", 123);
    expect(await uploadProjectCover(f)).toEqual({
      url: "https://api.test/media/covers/k.png",
      key: "",
      content_type: "image/png",
      bytes: 123,
    });
    const [url, init] = authFetch.mock.calls[0];
    expect(url).toBe("https://api.test/media/upload");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("rejects a bad file before any request", async () => {
    await expect(uploadProjectCover(file("a.gif", "image/gif"))).rejects.toThrow(/JPEG/);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("maps 501 to MEDIA_DISABLED with the server hint", async () => {
    authFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "disabled", hint: "Covers launch soon." }), { status: 501 }),
    );
    await expect(uploadProjectCover(file("c.png", "image/png"))).rejects.toMatchObject({
      code: "MEDIA_DISABLED",
      message: "Covers launch soon.",
    });
  });

  it("surfaces the server error, or the HTTP status when there is none", async () => {
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "too big" }), { status: 413 }));
    await expect(uploadProjectCover(file("c.png", "image/png"))).rejects.toThrow("too big");
    authFetch.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    await expect(uploadProjectCover(file("c.png", "image/png"))).rejects.toThrow(
      "Upload failed (HTTP 500)",
    );
  });

  it("fails on a network error or an OK response without a URL", async () => {
    authFetch.mockRejectedValueOnce(new Error("offline"));
    await expect(uploadProjectCover(file("c.png", "image/png"))).rejects.toThrow(/Could not reach/);
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify({})));
    await expect(uploadProjectCover(file("c.png", "image/png"))).rejects.toThrow(/no URL/);
  });
});
