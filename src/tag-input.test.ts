import { afterEach, describe, expect, it } from "vitest";
import {
  filterSuggestedTags,
  normalizeTag,
  parseTagList,
  SUGGESTED_PROPOSAL_TAGS,
} from "./proposal-tags";
import { bindTagInput, tagInputHtml } from "./tag-input";

describe("proposal tag helpers", () => {
  it("normalizes and parses tags", () => {
    expect(normalizeTag("  Policy ")).toBe("policy");
    expect(normalizeTag("Bitcoin Core")).toBe("bitcoin-core");
    expect(normalizeTag("!!!")).toBeNull();
    expect(parseTagList("knots, Policy, knots, docs")).toEqual([
      "knots",
      "policy",
      "docs",
    ]);
  });

  it("filters suggested vocabulary against selection and query", () => {
    expect(filterSuggestedTags("li", ["docs"])).toContain("lightning");
    expect(filterSuggestedTags("", ["docs"])).not.toContain("docs");
    expect(SUGGESTED_PROPOSAL_TAGS).toContain("knots");
  });
});

describe("tag input control", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders chips, presets, and a hidden form value", () => {
    const html = tagInputHtml({
      id: "propose-tags",
      name: "tags",
      tags: ["docs", "policy"],
    });
    expect(html).toContain('id="propose-tags"');
    expect(html).toContain("tag-chip");
    expect(html).toContain("docs");
    expect(html).toContain("policy");
    expect(html).toContain('name="tags"');
    expect(html).toContain('value="docs, policy"');
    expect(html).toContain("tag-preset");
    expect(html).toContain("lightning");
  });

  it("adds tags from presets, typing, and removes chips", () => {
    document.body.innerHTML = tagInputHtml({
      id: "propose-tags",
      name: "tags",
      tags: [],
    });
    const handle = bindTagInput(document, "propose-tags");
    expect(handle).toBeTruthy();

    document.querySelector<HTMLButtonElement>('[data-add-tag="knots"]')!.click();
    expect(handle!.getTags()).toEqual(["knots"]);
    expect(
      document.querySelector<HTMLInputElement>("#propose-tags-value")?.value,
    ).toBe("knots");
    expect(
      document.querySelector<HTMLButtonElement>('[data-add-tag="knots"]')?.hidden,
    ).toBe(true);

    const field = document.querySelector<HTMLInputElement>("#propose-tags-field")!;
    field.value = "custom-tag";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handle!.getTags()).toEqual(["knots", "custom-tag"]);

    document
      .querySelector<HTMLButtonElement>('[data-remove-tag="knots"]')!
      .click();
    expect(handle!.getTags()).toEqual(["custom-tag"]);

    handle!.setTags(["ui", "security"]);
    expect(handle!.getTags()).toEqual(["ui", "security"]);
    expect(
      document.querySelectorAll(".tag-chip").length,
    ).toBe(2);
  });

  it("shows autocomplete matches while typing", () => {
    document.body.innerHTML = tagInputHtml({
      id: "propose-tags",
      name: "tags",
    });
    bindTagInput(document, "propose-tags");
    const field = document.querySelector<HTMLInputElement>("#propose-tags-field")!;
    const suggest = document.querySelector<HTMLElement>("#propose-tags-suggest")!;

    field.focus();
    field.value = "sec";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(suggest.hidden).toBe(false);
    expect(suggest.textContent).toContain("security");
  });
});
