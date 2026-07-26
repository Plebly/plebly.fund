import {
  filterSuggestedTags,
  MAX_PROPOSAL_TAGS,
  normalizeTag,
  parseTagList,
  SUGGESTED_PROPOSAL_TAGS,
} from "./proposal-tags";
import { escapeHtml } from "./util";

export type TagInputHandle = {
  getTags: () => string[];
  setTags: (tags: string[]) => void;
  focus: () => void;
};

export function tagInputHtml(opts: {
  id: string;
  name: string;
  tags?: string[];
  max?: number;
  placeholder?: string;
  vocabulary?: readonly string[];
  /** Quick-pick chips; defaults to vocabulary. Pass [] to hide. */
  presets?: readonly string[];
  hint?: string;
}): string {
  const id = opts.id;
  const max = opts.max ?? MAX_PROPOSAL_TAGS;
  const tags = parseTagList(opts.tags || [], max);
  const placeholder = opts.placeholder || "Type a tag, then Enter";
  const vocab = opts.vocabulary || SUGGESTED_PROPOSAL_TAGS;
  const presetSource = opts.presets ?? vocab;
  const hint =
    opts.hint ||
    `Pick suggested tags or type your own. Up to ${max}. Enter or comma to add.`;
  const chips = tags
    .map(
      (tag) =>
        `<li class="tag-chip" role="listitem" data-tag="${escapeHtml(tag)}">
          <span class="tag-chip-label">${escapeHtml(tag)}</span>
          <button type="button" class="tag-chip-remove" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">&times;</button>
        </li>`,
    )
    .join("");
  const presets = presetSource
    .map(
      (tag) =>
        `<button type="button" class="tag-preset" data-add-tag="${escapeHtml(tag)}" ${tags.includes(tag) ? "hidden" : ""}>${escapeHtml(tag)}</button>`,
    )
    .join("");

  return `<div class="tag-input" id="${escapeHtml(id)}" data-max="${max}">
    <div class="tag-input-box">
      <ul class="tag-input-chips" id="${escapeHtml(id)}-chips" role="list">${chips}</ul>
      <input
        id="${escapeHtml(id)}-field"
        class="tag-input-field"
        type="text"
        autocomplete="off"
        spellcheck="false"
        maxlength="40"
        placeholder="${escapeHtml(placeholder)}"
        aria-autocomplete="list"
        aria-controls="${escapeHtml(id)}-suggest"
        aria-expanded="false"
      />
      <ul class="tag-input-suggest" id="${escapeHtml(id)}-suggest" role="listbox" hidden></ul>
    </div>
    <input type="hidden" name="${escapeHtml(opts.name)}" id="${escapeHtml(id)}-value" value="${escapeHtml(tags.join(", "))}" />
    <div class="tag-input-presets" id="${escapeHtml(id)}-presets" aria-label="Suggested tags" ${presetSource.length ? "" : "hidden"}>
      ${presets}
    </div>
    <p class="field-hint tag-input-hint">${escapeHtml(hint)}</p>
  </div>`;
}

export function bindTagInput(
  root: ParentNode,
  id: string,
  opts?: { vocabulary?: readonly string[] },
): TagInputHandle | null {
  const wrap = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (!wrap) return null;

  const chipsEl = wrap.querySelector<HTMLElement>(`#${CSS.escape(id)}-chips`);
  const field = wrap.querySelector<HTMLInputElement>(`#${CSS.escape(id)}-field`);
  const hidden = wrap.querySelector<HTMLInputElement>(`#${CSS.escape(id)}-value`);
  const suggestEl = wrap.querySelector<HTMLElement>(`#${CSS.escape(id)}-suggest`);
  const presetsEl = wrap.querySelector<HTMLElement>(`#${CSS.escape(id)}-presets`);
  if (!chipsEl || !field || !hidden || !suggestEl || !presetsEl) return null;

  const max = Number(wrap.dataset.max || MAX_PROPOSAL_TAGS) || MAX_PROPOSAL_TAGS;
  const vocabulary = opts?.vocabulary || SUGGESTED_PROPOSAL_TAGS;
  let tags = parseTagList(hidden.value, max);
  let activeIndex = -1;

  const syncHidden = () => {
    hidden.value = tags.join(", ");
  };

  const renderChips = () => {
    chipsEl.innerHTML = tags
      .map(
        (tag) =>
          `<li class="tag-chip" role="listitem" data-tag="${escapeHtml(tag)}">
            <span class="tag-chip-label">${escapeHtml(tag)}</span>
            <button type="button" class="tag-chip-remove" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">&times;</button>
          </li>`,
      )
      .join("");
    presetsEl.querySelectorAll<HTMLButtonElement>("[data-add-tag]").forEach((btn) => {
      const tag = btn.dataset.addTag || "";
      btn.hidden = tags.includes(tag);
    });
    syncHidden();
    field.placeholder = tags.length ? "Add another…" : "Type a tag, then Enter";
    field.disabled = tags.length >= max;
  };

  const hideSuggest = () => {
    suggestEl.hidden = true;
    suggestEl.innerHTML = "";
    activeIndex = -1;
    field.setAttribute("aria-expanded", "false");
  };

  const paintSuggest = (items: string[], typed: string | null) => {
    if (!items.length) {
      hideSuggest();
      return;
    }
    suggestEl.innerHTML = items
      .map((tag, i) => {
        const isCustom = Boolean(
          typed && tag === typed && !(vocabulary as readonly string[]).includes(tag),
        );
        const label = isCustom ? `Add “${tag}”` : tag;
        return `<li role="option" class="tag-suggest-item${i === 0 ? " active" : ""}" data-suggest-tag="${escapeHtml(tag)}" id="${escapeHtml(id)}-opt-${i}">${escapeHtml(label)}</li>`;
      })
      .join("");
    activeIndex = 0;
    suggestEl.hidden = false;
    field.setAttribute("aria-expanded", "true");
  };

  const renderSuggest = () => {
    if (tags.length >= max) {
      hideSuggest();
      return;
    }
    const query = field.value.trim();
    const typed = normalizeTag(query);
    if (!query) {
      paintSuggest(filterSuggestedTags("", tags, vocabulary).slice(0, 12), null);
      return;
    }
    const matches = filterSuggestedTags(query, tags, vocabulary).slice(0, 12);
    const items = [...matches];
    if (typed && !tags.includes(typed) && !items.includes(typed)) {
      items.unshift(typed);
    }
    paintSuggest(items.slice(0, 12), typed);
  };

  const addTag = (raw: string): boolean => {
    const tag = normalizeTag(raw);
    if (!tag || tags.includes(tag) || tags.length >= max) return false;
    tags = [...tags, tag];
    field.value = "";
    renderChips();
    hideSuggest();
    return true;
  };

  const removeTag = (tag: string) => {
    tags = tags.filter((item) => item !== tag);
    renderChips();
    renderSuggest();
  };

  chipsEl.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest?.("[data-remove-tag]");
    if (!(btn instanceof HTMLElement) || !chipsEl.contains(btn)) return;
    event.preventDefault();
    removeTag(btn.dataset.removeTag || "");
    field.focus();
  });

  presetsEl.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement | null)?.closest?.("[data-add-tag]");
    if (!(btn instanceof HTMLElement) || !presetsEl.contains(btn)) return;
    event.preventDefault();
    addTag(btn.dataset.addTag || "");
    field.focus();
  });

  suggestEl.addEventListener("mousedown", (event) => {
    // Prevent blur before click applies.
    event.preventDefault();
  });

  suggestEl.addEventListener("click", (event) => {
    const item = (event.target as HTMLElement | null)?.closest?.("[data-suggest-tag]");
    if (!(item instanceof HTMLElement) || !suggestEl.contains(item)) return;
    addTag(item.dataset.suggestTag || "");
    field.focus();
  });

  field.addEventListener("input", () => {
    // Support comma-as-you-type
    if (field.value.includes(",")) {
      const parts = field.value.split(",");
      const last = parts.pop() || "";
      for (const part of parts) addTag(part);
      field.value = last;
    }
    renderSuggest();
  });

  field.addEventListener("keydown", (event) => {
    const options = [
      ...suggestEl.querySelectorAll<HTMLElement>("[data-suggest-tag]"),
    ];
    if (event.key === "ArrowDown" && !suggestEl.hidden && options.length) {
      event.preventDefault();
      activeIndex = (activeIndex + 1) % options.length;
      options.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
      return;
    }
    if (event.key === "ArrowUp" && !suggestEl.hidden && options.length) {
      event.preventDefault();
      activeIndex = (activeIndex - 1 + options.length) % options.length;
      options.forEach((el, i) => el.classList.toggle("active", i === activeIndex));
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (!suggestEl.hidden && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        addTag(options[activeIndex]!.dataset.suggestTag || "");
        return;
      }
      if (event.key === "Enter" && field.value.trim()) {
        event.preventDefault();
        addTag(field.value);
      }
      return;
    }
    if (event.key === "Escape") {
      hideSuggest();
      return;
    }
    if (event.key === "Backspace" && !field.value && tags.length) {
      removeTag(tags[tags.length - 1]!);
    }
  });

  field.addEventListener("focus", () => {
    renderSuggest();
  });

  field.addEventListener("blur", () => {
    // Commit leftover token, then close suggestions shortly after.
    window.setTimeout(() => {
      if (field.value.trim()) addTag(field.value);
      hideSuggest();
    }, 120);
  });

  wrap.addEventListener("click", (event) => {
    if (event.target === wrap || event.target === chipsEl || event.target === field) {
      field.focus();
    }
  });

  renderChips();

  return {
    getTags: () => [...tags],
    setTags: (next) => {
      tags = parseTagList(next, max);
      field.value = "";
      renderChips();
      hideSuggest();
    },
    focus: () => field.focus(),
  };
}
