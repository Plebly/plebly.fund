export type ProposalTemplate = {
  id: "docs" | "tooling" | "research";
  label: string;
  title: string;
  problem: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  tags: string[];
};

export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    id: "docs",
    label: "Documentation",
    title: "Improve documentation for [audience]",
    problem: "Explain the documentation gap, the Bitcoin audience affected, and why existing guidance is insufficient.",
    deliverable: "- Publish the named guides in a public repository.\n- Include examples or screenshots where useful.\n- Use an open-source license.",
    verification: "1. Open the published documentation URLs.\n2. Follow each command or setup path from a clean environment.\n3. Confirm the guide covers the stated audience.",
    out_of_scope: "Product implementation, ongoing support, and translations unless listed above.",
    tags: ["docs"],
  },
  {
    id: "tooling",
    label: "Tooling",
    title: "Build [tool] for [workflow]",
    problem: "Describe the operational or developer workflow that is slow, unsafe, or unreliable, and who uses it.",
    deliverable: "- Publish source code in a public repository with an OSI-approved license.\n- Provide reproducible build and test instructions.\n- Document inputs, outputs, configuration, and failure modes.",
    verification: "1. Clone the public repository at the submitted commit.\n2. Run the documented build and test commands.\n3. Exercise the documented example and confirm the expected output.",
    out_of_scope: "Hosted operations, key custody, and integrations not explicitly named above.",
    tags: ["tooling"],
  },
  {
    id: "research",
    label: "Research",
    title: "Research [Bitcoin question]",
    problem: "State the Bitcoin question being investigated, why it matters, and which decisions the findings should inform.",
    deliverable: "- Publish a report with sources and methodology.\n- Publish reproducible data, code, or calculations where legally possible.\n- Separate evidence, assumptions, and recommendations.",
    verification: "1. Read the public report and inspect its citations.\n2. Re-run supplied calculations or scripts.\n3. Confirm the report answers the stated question and records limitations.",
    out_of_scope: "Production implementation, investment advice, and claims beyond the documented evidence.",
    tags: ["research"],
  },
];
