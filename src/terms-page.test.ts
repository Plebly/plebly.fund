import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTerms } from "./terms-page";

const TOS = [
  "# Terms of Service",
  "",
  "version: tos-2026-09-13  ",
  "published_at: 2026-09-13T00:00:00.000Z",
  "",
  "",
  "",
  "These terms describe how funding works.",
  "",
].join("\n");

const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;
const text = () => app().textContent!.replace(/\s+/g, " ");

let respond: () => Promise<Response>;
const fetchMock = vi.fn(async (_url: string) => respond());

beforeEach(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  respond = async () => new Response(TOS, { status: 200, headers: { "Content-Type": "text/markdown" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("renderTerms", () => {
  it("fetches /docs/TOS.md and renders it as prose inside the shell", async () => {
    await renderTerms(shell);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/docs\/TOS\.md$/);
    expect(app().querySelector("main[data-shell]")).not.toBeNull();
    const prose = app().querySelector(".prose-rich");
    expect(prose).not.toBeNull();
    // happy-dom's parser drops the tag of the first sanitized element (real
    // browsers keep the <h1>), so assert the heading text, not the tag.
    expect(prose!.textContent).toContain("Terms of Service");
    expect(prose!.textContent).toContain("These terms describe");
    expect(app().querySelector(".loading")).toBeNull();
    expect(app().querySelector("h1")?.textContent).toBe("Terms");
  });

  it("strips the version and published_at metadata lines before rendering", async () => {
    await renderTerms(shell);
    expect(text()).not.toContain("version:");
    expect(text()).not.toContain("tos-2026-09-13");
    expect(text()).not.toContain("published_at");
  });

  it("links About, Parameters and Projects", async () => {
    await renderTerms(shell);
    const hrefs = [...app().querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/about", "/parameters"]));
    expect(hrefs.some((h) => h && /project|^\/$/.test(h))).toBe(true);
  });

  it.each([
    ["a non-2xx response", async () => new Response("missing", { status: 404 })],
    ["a network error", async () => Promise.reject(new TypeError("offline"))],
    ["an empty file", async () => new Response("version: x\npublished_at: y\n", { status: 200 })],
  ])("%s shows the calm fallback, no prose and no loading spinner", async (_n, r) => {
    respond = r as () => Promise<Response>;
    await renderTerms(shell);
    expect(text()).toContain("Terms could not be loaded.");
    expect(app().querySelector(".prose-rich")).toBeNull();
    expect(app().querySelector(".loading")).toBeNull();
    expect(app().querySelector("h1")?.textContent).toBe("Terms");
  });

  it("paints the loading state before the fetch settles", async () => {
    let release!: (r: Response) => void;
    respond = () => new Promise<Response>((res) => (release = res));
    const done = renderTerms(shell);
    expect(app().querySelector(".loading")?.textContent).toBe("Loading terms…");
    release(new Response(TOS, { status: 200 }));
    await done;
    expect(app().querySelector(".loading")).toBeNull();
  });
});
