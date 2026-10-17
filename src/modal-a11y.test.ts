import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmAction } from "./confirm-modal";
import { focusableIn, installModalA11y, modalCloseControl } from "./modal-a11y";

const flush = () => new Promise((r) => setTimeout(r, 0));

function press(key: string, shiftKey = false): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement || document.body).dispatchEvent(ev);
  return ev;
}

/** A modal in the shared markup that only closes via its own controls. */
function mountHiddenModal(): { opener: HTMLButtonElement; modal: HTMLElement } {
  document.body.innerHTML = `
    <header><a href="/" id="home">Home</a></header>
    <button type="button" id="open">Open</button>
    <div class="site-modal" id="m" hidden>
      <div class="site-modal-backdrop" data-test-close tabindex="-1" aria-hidden="true"></div>
      <div class="site-modal-card" role="dialog" aria-modal="true" aria-labelledby="t">
        <button type="button" class="site-modal-close" id="x" aria-label="Close">x</button>
        <h2 id="t" tabindex="-1">Title</h2>
        <input id="amount" />
        <button type="button" id="hidden-btn" hidden>never</button>
        <button type="button" id="ok">OK</button>
      </div>
    </div>`;
  const opener = document.getElementById("open") as HTMLButtonElement;
  const modal = document.getElementById("m") as HTMLElement;
  opener.addEventListener("click", () => {
    modal.hidden = false;
  });
  modal.querySelectorAll("#x, [data-test-close]").forEach((el) =>
    el.addEventListener("click", () => {
      modal.hidden = true;
    }),
  );
  return { opener, modal };
}

async function openIt(): Promise<{ opener: HTMLButtonElement; modal: HTMLElement }> {
  const m = mountHiddenModal();
  m.opener.focus();
  m.opener.click();
  await flush();
  return m;
}

describe("installModalA11y", () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installModalA11y();
  });
  afterEach(() => {
    uninstall();
    document.body.innerHTML = "";
  });

  it("moves focus into a modal when it opens", async () => {
    const { modal } = await openIt();
    expect(modal.contains(document.activeElement)).toBe(true);
  });

  it("wraps Tab from the last control to the first", async () => {
    await openIt();
    document.getElementById("ok")!.focus();
    const ev = press("Tab");
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("x");
  });

  it("wraps Shift+Tab from the first control to the last", async () => {
    await openIt();
    document.getElementById("x")!.focus();
    const ev = press("Tab", true);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("ok");
  });

  it("leaves Tab alone between controls in the middle", async () => {
    await openIt();
    document.getElementById("x")!.focus();
    expect(press("Tab").defaultPrevented).toBe(false);
  });

  it("pulls focus back in when it has escaped to the page", async () => {
    await openIt();
    document.getElementById("home")!.focus();
    press("Tab");
    expect(document.activeElement?.id).toBe("x");
  });

  it("steps from a tabindex=-1 heading to the next control", async () => {
    await openIt();
    document.getElementById("t")!.focus();
    press("Tab");
    expect(document.activeElement?.id).toBe("amount");
  });

  it("skips hidden and tabindex=-1 controls", () => {
    const { modal } = mountHiddenModal();
    modal.hidden = false;
    expect(focusableIn(modal).map((el) => el.id)).toEqual(["x", "amount", "ok"]);
  });

  it("Esc closes a modal with no Esc handler of its own, then refocuses the opener", async () => {
    const { opener, modal } = await openIt();
    expect(modal.hidden).toBe(false);
    press("Escape");
    await flush();
    await flush();
    expect(modal.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it("Esc does nothing extra when a control inside consumed it", async () => {
    const { modal } = await openIt();
    const input = document.getElementById("amount")!;
    input.focus();
    input.addEventListener("keydown", (e) => e.preventDefault());
    press("Escape");
    await flush();
    expect(modal.hidden).toBe(false);
  });

  it("restores focus to the opener after a removed modal (confirmAction)", async () => {
    document.body.innerHTML = `<button type="button" id="del">Delete</button>`;
    const del = document.getElementById("del") as HTMLButtonElement;
    del.focus();
    const pending = confirmAction({ title: "Delete?", body: "Sure?" });
    await flush();
    expect(
      document.querySelector(".confirm-modal")?.contains(document.activeElement),
    ).toBe(true);
    press("Escape");
    await expect(pending).resolves.toBe(false);
    await flush();
    expect(document.activeElement).toBe(del);
  });

  it("closes only the top modal on Esc when two are stacked", async () => {
    const { modal } = await openIt();
    const ok = document.getElementById("ok") as HTMLButtonElement;
    ok.focus();
    const pending = confirmAction({ title: "Really?", body: "Sure?" });
    await flush();
    press("Escape");
    await expect(pending).resolves.toBe(false);
    await flush();
    await flush();
    expect(modal.hidden).toBe(false);
    expect(document.activeElement).toBe(ok);
  });

  it("finds the close button, or a closing backdrop", () => {
    const { modal } = mountHiddenModal();
    expect(modalCloseControl(modal)?.id).toBe("x");
    modal.querySelector(".site-modal-close")!.remove();
    expect(modalCloseControl(modal)?.className).toBe("site-modal-backdrop");
  });
});
