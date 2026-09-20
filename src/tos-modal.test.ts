import { describe, expect, it } from "vitest";
import { tosAckCardHtml, tosCheckboxHtml } from "./tos-modal";

describe("tosCheckboxHtml", () => {
  it("links /terms and requires a checkbox", () => {
    const html = tosCheckboxHtml("claim-tos-ack");
    expect(html).toContain('id="claim-tos-ack"');
    expect(html).toContain("required");
    expect(html).toContain("/terms");
    expect(html).toContain('class="tos-doc-link"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("coordinator");
    expect(html).not.toContain("legal advice");
  });

  it("puts the propose last-step checkbox in a card with the submit action", () => {
    const html = tosAckCardHtml({
      checkboxId: "propose-tos-ack",
      heading: "Before you list",
      submitLabel: "List project",
    });
    expect(html).toContain('id="propose-tos-ack"');
    expect(html).toContain("propose-tos-card");
    expect(html).toContain("does not sell");
    expect(html).toContain("never holds your keys");
    expect(html).toContain("propose-wizard-submit");
    expect(html).toContain("List project");
    expect(html).toContain("propose-wizard-back");
    expect(html).not.toContain("tos-ack-label muted");
  });
});
