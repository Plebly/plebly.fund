import { describe, expect, it } from "vitest";
import { tosCheckboxHtml } from "./tos-modal";

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
});
