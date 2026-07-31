## About Plebly

Plebly is a public funding platform for **Bitcoin ecosystem work** that needs a non-custodial surface. Protocol work, tooling, research, legal analysis, documentation, and related open problems all belong here. This site lists open projects, shows on-chain escrow balances, and connects builders with funded work without a central gatekeeper holding the keys.

We built it for people who want hard problems solved in the open.

## What we believe

**Non-custodial escrow.** Escrow addresses are publicly verifiable multisig. No organization, including Plebly, can freeze, redirect, or confiscate funds. Payment follows the rules, not an admin button.

**Uncensorable proposals.** The canonical record lives in [Plebly/proposals](https://github.com/Plebly/proposals). Anyone can fork it. We may decline to list a proposal, but we cannot erase it or its funding history.

**Protocol over platform.** Parameters, keyholders, and escrow rules are published in git. Changes require a public process and notice, not a silent config change.

## How it works

1. **Submit**: Open a pull request with your proposal and pay the submission fee on-chain.
2. **Donate**: Anyone sends Bitcoin to the project's escrow address (on-chain, or Lightning that settles into that same address).
3. **Claim**: A builder claims the project once funding hits the claim floor.
4. **Complete**: Reviewers verify the deliverable; keyholders release escrow manually on success. Plebly never moves funds.

Browse [open projects](/), [start a project](/propose), or read the full rules in the [proposals repo](https://github.com/Plebly/proposals).

## For builders

Watch a project to follow funding progress. Watching does **not** reserve the work. When confirmed escrow meets the claim floor, use **Claim this project** on the project page. That opens a pull request in the proposals repo; the exclusive claim and 90-day window start when the PR merges. Then submit your deliverable the same way for public review.

## Lightning donations

Lightning is a way to fund the same on-chain escrow address. After payment settles, the project's balance and claim floor update as usual.

- Unpaid invoices do **not** count toward funding.
- Network and routing fees may reduce the amount that lands in escrow.
- Lightning is available on **mainnet**. Signet stays on-chain only.

## Key parameters

These numbers are fixed at launch and pulled from [PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md) on every deploy:

- **Submission fee:** {{submission_fee}} (paid when you open a proposal; exact and non-refundable).
- **Platform fee:** {{platform_fee}} (paid to Plebly from escrow only when a project completes successfully).
- **Claim floor:** {{minimum_funding_claim_floor}} (minimum escrow balance before a builder can claim).
- **Claim window:** {{claim_window}} after a claim is accepted. {{claim_extension}}.

Milestone splits apply above **{{milestone_threshold}}**. Badge tiers, funding windows, and confirmation counts are documented in PARAMETERS.md.

## Trust model

Escrow is **3-of-5 multisig**. Plebly never holds a spending key. Launch uses human keyholders.

If keyholders stall after a reviewer-approved release, the public process applies: a 7-day log followed by a 14-day incident process.

See [Keyholders](#keyholders) for the live roster and [Key parameters](#parameters) for fees and floors.

## Testing vs launch

The site is currently on **{{bitcoin_network}}** for end-to-end testing. Launch will use **mainnet only** with 3-of-5 multisig escrow. See [Keyholders](#keyholders).

## Get involved

Follow updates on [X @joinplebly](https://x.com/joinplebly) and [GitHub @Plebly](https://github.com/Plebly). Questions, proposals, and corrections belong in the open repo.
