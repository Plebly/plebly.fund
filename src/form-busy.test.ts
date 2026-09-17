import { describe, expect, it, vi } from "vitest";
import { isBusy, runBusy, runFormBusy, setFormBusy } from "./form-busy";

function formWithButtons(): HTMLFormElement {
  const form = document.createElement("form");
  form.innerHTML = `
    <button type="button" id="back">Back</button>
    <button type="submit" id="go">Open proposal</button>
  `;
  document.body.append(form);
  return form;
}

describe("form busy lock", () => {
  it("disables every control and restores labels after error", async () => {
    const form = formWithButtons();
    const submit = form.querySelector("#go") as HTMLButtonElement;
    const back = form.querySelector("#back") as HTMLButtonElement;
    await expect(
      runFormBusy(
        form,
        async () => {
          expect(isBusy(form)).toBe(true);
          expect(submit.disabled).toBe(true);
          expect(back.disabled).toBe(true);
          expect(submit.textContent).toBe("Opening pull request…");
          expect(back.textContent).toBe("Back");
          throw new Error("submission_fee could not be checked on mempool — try again");
        },
        { busyLabel: "Opening pull request…" },
      ),
    ).rejects.toThrow(/try again/);
    expect(isBusy(form)).toBe(false);
    expect(submit.disabled).toBe(false);
    expect(back.disabled).toBe(false);
    expect(submit.textContent).toBe("Open proposal");
  });

  it("ignores a second submit while busy", async () => {
    const form = formWithButtons();
    setFormBusy(form, true, "Opening pull request…");
    const inner = vi.fn();
    await expect(runFormBusy(form, inner)).resolves.toBeUndefined();
    expect(inner).not.toHaveBeenCalled();
  });

  it("keeps a lone button locked after success when asked", async () => {
    const btn = document.createElement("button");
    btn.textContent = "Submit application";
    document.body.append(btn);
    await runBusy(btn, async () => "ok", {
      busyLabel: "Submitting…",
      stayBusyOnSuccess: true,
    });
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Submitting…");
  });
});
