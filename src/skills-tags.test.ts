import { describe, expect, it } from "vitest";
import {
  MAX_SKILLS_TAGS,
  SKILLS_PRESET_TAGS,
  SUGGESTED_SKILLS_TAGS,
} from "./skills-tags";
import { tagInputHtml } from "./tag-input";

describe("skills tags vocabulary", () => {
  it("exposes an extensive autocomplete list and compact presets", () => {
    expect(MAX_SKILLS_TAGS).toBe(20);
    expect(SUGGESTED_SKILLS_TAGS.length).toBeGreaterThan(80);
    expect(SKILLS_PRESET_TAGS.length).toBeLessThanOrEqual(16);
    expect(SUGGESTED_SKILLS_TAGS).toEqual(
      [...SUGGESTED_SKILLS_TAGS].sort((a, b) => a.localeCompare(b)),
    );
    for (const tag of SKILLS_PRESET_TAGS) {
      expect(SUGGESTED_SKILLS_TAGS).toContain(tag);
    }
  });

  it("covers core Bitcoin skill areas", () => {
    for (const tag of [
      "bitcoin-core",
      "knots",
      "libbitcoin",
      "consensus",
      "lightning",
      "rust",
      "ldk",
      "bdk",
      "nostr",
      "cryptography",
      "miniscript",
      "taproot",
      "libsecp256k1",
      "mempool-policy",
      "stratum-v2",
      "fedimint",
      "payjoin",
      "silent-payments",
    ]) {
      expect(SUGGESTED_SKILLS_TAGS).toContain(tag);
    }
  });
});

describe("skills tag input markup", () => {
  it("uses the skills vocabulary with limited preset chips", () => {
    const html = tagInputHtml({
      id: "skills-tags",
      name: "skills_tags",
      tags: ["rust"],
      max: MAX_SKILLS_TAGS,
      vocabulary: SUGGESTED_SKILLS_TAGS,
      presets: SKILLS_PRESET_TAGS,
      hint: "Add skills and interests.",
    });
    expect(html).toContain('id="skills-tags"');
    expect(html).toContain('data-max="20"');
    expect(html).toContain("Add skills and interests.");
    expect(html).toContain('data-add-tag="lightning"');
    expect(html).toContain("rust");
    // Full vocabulary is not dumped into preset buttons.
    expect(html.match(/data-add-tag=/g)?.length).toBe(SKILLS_PRESET_TAGS.length);
  });
});
