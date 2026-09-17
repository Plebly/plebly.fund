type BusyControl = HTMLButtonElement | HTMLInputElement;

function isBusyControl(el: Element): el is BusyControl {
  return el instanceof HTMLButtonElement || el instanceof HTMLInputElement;
}

export function isBusy(root: HTMLElement): boolean {
  return root.dataset.submitBusy === "1";
}

export function formActionControls(form: HTMLFormElement): BusyControl[] {
  return Array.from(form.querySelectorAll("button, input[type=submit]")).filter(
    isBusyControl,
  );
}

export function setControlBusy(
  el: BusyControl,
  busy: boolean,
  busyLabel?: string,
): void {
  if (busy) {
    if (el.dataset.submitBusy === "1") return;
    el.dataset.submitBusy = "1";
    el.dataset.labelRestore =
      el instanceof HTMLInputElement ? el.value : el.textContent || "";
    el.disabled = true;
    el.setAttribute("aria-busy", "true");
    if (busyLabel) {
      if (el instanceof HTMLInputElement) el.value = busyLabel;
      else el.textContent = busyLabel;
    }
    return;
  }
  delete el.dataset.submitBusy;
  el.disabled = false;
  el.removeAttribute("aria-busy");
  const restore = el.dataset.labelRestore;
  delete el.dataset.labelRestore;
  if (restore === undefined) return;
  if (el instanceof HTMLInputElement) el.value = restore;
  else el.textContent = restore;
}

export function setFormBusy(
  form: HTMLFormElement,
  busy: boolean,
  busyLabel?: string,
): void {
  if (busy) form.dataset.submitBusy = "1";
  else delete form.dataset.submitBusy;
  const controls = formActionControls(form);
  const submit = controls.find(
    (el) =>
      (el instanceof HTMLButtonElement && el.type === "submit") ||
      (el instanceof HTMLInputElement && el.type === "submit"),
  );
  for (const el of controls) {
    setControlBusy(el, busy, el === submit ? busyLabel : undefined);
  }
}

export async function runBusy<T>(
  controls: BusyControl | BusyControl[],
  fn: () => Promise<T>,
  opts?: { busyLabel?: string; stayBusyOnSuccess?: boolean },
): Promise<T | undefined> {
  const list = Array.isArray(controls) ? controls : [controls];
  if (list.some((el) => el.dataset.submitBusy === "1")) return undefined;
  for (const el of list) setControlBusy(el, true, opts?.busyLabel);
  try {
    const result = await fn();
    if (!opts?.stayBusyOnSuccess) {
      for (const el of list) setControlBusy(el, false);
    }
    return result;
  } catch (err) {
    for (const el of list) setControlBusy(el, false);
    throw err;
  }
}

export async function runFormBusy<T>(
  form: HTMLFormElement,
  fn: () => Promise<T>,
  opts?: { busyLabel?: string; stayBusyOnSuccess?: boolean },
): Promise<T | undefined> {
  if (isBusy(form)) return undefined;
  setFormBusy(form, true, opts?.busyLabel);
  try {
    const result = await fn();
    if (!opts?.stayBusyOnSuccess) setFormBusy(form, false);
    return result;
  } catch (err) {
    setFormBusy(form, false);
    throw err;
  }
}
