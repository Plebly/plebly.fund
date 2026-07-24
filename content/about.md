## About Plebly

Plebly is a public funding platform for **Bitcoin development and research**. This site lists open projects, shows on-chain escrow balances, and connects builders with funded work — without a central gatekeeper holding the keys.

We built it for people who want hard problems solved in the open: protocol work, tooling, research, and infrastructure that makes Bitcoin better for everyone.

## What we believe

**Non-custodial escrow.** Escrow addresses are publicly verifiable multisig. No organization — including Plebly — can freeze, redirect, or confiscate funds. Payment follows the rules, not an admin button.

**Uncensorable proposals.** The canonical record lives in [Plebly/proposals](https://github.com/Plebly/proposals). Anyone can fork it. We may decline to list a proposal, but we cannot erase it or its funding history.

**Protocol over platform.** Parameters, keyholders, and escrow rules are published in git. Changes require a public process and notice — not a silent config change.

## How it works

1. **Submit** — Open a pull request with your proposal and pay the submission fee on-chain.
2. **Donate** — Anyone sends Bitcoin to the project's escrow address (on-chain, or Lightning that settles into that same address).
3. **Claim** — A builder claims the project once funding hits the claim floor.
4. **Complete** — Reviewers verify the deliverable; keyholders release escrow on success.

Browse [open projects](#/), [start a project](#/propose), or read the full rules in the [proposals repo](https://github.com/Plebly/proposals).

## For builders

Watch a project to follow funding progress — watching does **not** reserve the work. When confirmed escrow meets the claim floor, use **Claim this project** on the project page. That opens a pull request in the proposals repo; the exclusive claim and 90-day window start when the PR merges. Then submit your deliverable the same way for public review.

## Lightning donations

Lightning is a **funding rail into on-chain escrow**, not a separate balance. A reverse submarine swap (via Boltz) pays a hold invoice; after the lockup confirms, Plebly’s claimer broadcasts a claim transaction **to the project’s escrow address**. Only then does the mempool balance — and the claim floor — move.

- Unpaid or in-flight invoices do **not** count toward the claim floor.
- Escrow credit is the invoice amount minus Boltz service and claim fees; the donate UI shows the expected on-chain credit.
- Minimum amounts follow the Boltz BTC/BTC reverse pair (often above the smallest on-chain presets).
- Lightning is enabled on **mainnet** production; signet demos stay on-chain only unless a staging flag is set.

## Key parameters

These numbers are fixed at launch and pulled from [PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md) on every deploy:

- **Submission fee:** {{submission_fee}} — paid when you open a proposal PR; exact and non-refundable.
- **Platform fee:** {{platform_fee}} — paid to Plebly from escrow only when a project completes successfully.
- **Claim floor:** {{minimum_funding_claim_floor}} — minimum escrow balance before a builder can claim.
- **Claim window:** {{claim_window}} after a claim is accepted, with a possible {{claim_extension}}.

Milestone splits apply above **{{milestone_threshold}}**. Badge tiers, funding windows, and confirmation counts are documented in PARAMETERS.md.

## Testing vs launch

The site is currently on **{{bitcoin_network}}** for end-to-end testing. Launch will use **mainnet only** with 3-of-5 multisig escrow — see [KEYHOLDERS.md](https://github.com/Plebly/proposals/blob/main/KEYHOLDERS.md).

## Get involved

Follow updates on [X @joinplebly](https://x.com/joinplebly) and [GitHub @Plebly](https://github.com/Plebly). Questions, proposals, and corrections belong in the open repo.
