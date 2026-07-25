import { describe, expect, it } from "vitest";
import {
  depKindLabel,
  depRefPlaceholder,
  dependsOnRowHtml,
  pleblyDepHref,
  relatedWorkRowHtml,
  validateDependsOnDrafts,
  validateRelatedWorkDrafts,
} from "./propose-deps";
import {
  canEditProposal,
  dependsOnHtml,
  relatedWorkHtml,
} from "./proposal-ui";

describe("propose deps helpers", () => {
  it("rows expose required fields and kind-aware placeholders", () => {
    expect(dependsOnRowHtml(0)).toContain("dep-kind");
    expect(dependsOnRowHtml(0)).toContain("dep-label");
    expect(dependsOnRowHtml(0)).toContain(depRefPlaceholder("plebly"));
    expect(dependsOnRowHtml(0, { kind: "external" })).toContain(
      depRefPlaceholder("external"),
    );
    expect(relatedWorkRowHtml(0)).toContain("rel-url");
  });

  it("maps kind labels and plebly refs to listed paths", () => {
    expect(depKindLabel("plebly")).toBe("Plebly");
    expect(depKindLabel("external")).toBe("External");
    expect(pleblyDepHref("demo")).toBe("proposals/listed/demo.md");
    expect(pleblyDepHref("claimed/foo")).toBe("proposals/claimed/foo.md");
    expect(pleblyDepHref("proposals/listed/bar.md")).toBe(
      "proposals/listed/bar.md",
    );
  });

  it("validates depends_on and related_work drafts", () => {
    expect(
      validateDependsOnDrafts([
        { kind: "external", label: "X", ref: "http://bad" },
      ]).ok,
    ).toBe(false);
    expect(
      validateDependsOnDrafts([
        { kind: "plebly", label: "Other", ref: "demo" },
      ]).ok,
    ).toBe(true);
    expect(
      validateRelatedWorkDrafts([{ label: "A", url: "https://example.com" }])
        .ok,
    ).toBe(true);
    expect(
      validateRelatedWorkDrafts([{ label: "A", url: "notaurl" }]).ok,
    ).toBe(false);
  });

  it("project page deps use friendly pills and link plebly refs", () => {
    const html = dependsOnHtml([
      { kind: "plebly", label: "Prior", ref: "demo" },
      {
        kind: "external",
        label: "BIP",
        ref: "https://example.com/bip",
      },
    ]);
    expect(html).toContain(">Plebly<");
    expect(html).toContain(">External<");
    expect(html).toContain("/proposal/listed/demo");
    expect(html).not.toContain(">plebly<");
  });

  it("related work omits secondary URL line when label is the URL", () => {
    const same = relatedWorkHtml([
      { label: "https://example.com/x", url: "https://example.com/x" },
    ]);
    expect(same).toContain("https://example.com/x");
    expect(same).not.toContain("dep-list-ref");

    const distinct = relatedWorkHtml([
      { label: "Spec", url: "https://example.com/spec" },
    ]);
    expect(distinct).toContain(">Spec<");
    expect(distinct).toContain("dep-list-ref");
    expect(distinct).toContain("https://example.com/spec");
  });

  it("canEditProposal gates on status and identity", () => {
    expect(
      canEditProposal(
        { username: "alice", github: "alice" },
        { username: "alice" },
        "listed",
      ),
    ).toBe(true);
    expect(
      canEditProposal(
        { username: "alice" },
        { username: "alice" },
        "claimed",
      ),
    ).toBe(false);
    expect(
      canEditProposal(
        { username: "alice" },
        { username: "bob" },
        "listed",
      ),
    ).toBe(false);
  });
});
