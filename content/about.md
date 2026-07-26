## About Plebly

Plebly funds open Bitcoin work through publicly verifiable on-chain escrow — protocol, tooling, research, legal analysis, documentation, and related ecosystem problems — without a custodian in the middle.

## What we believe

**Non-custodial escrow.** Escrow addresses are publicly verifiable multisig. No organization — including Plebly — can freeze, redirect, or confiscate funds. Payment follows the rules, not an admin button.

**Uncensorable proposals.** The canonical record lives in [Plebly/proposals](https://github.com/Plebly/proposals). Anyone can fork it. We may decline to list a proposal, but we cannot erase it or its funding history.

**Protocol over platform.** Parameters, keyholders, and escrow rules are published in git. Changes require a public process and notice — not a silent config change.

## How it works

1. **Submit** — Open a pull request with your proposal and pay the submission fee on-chain.
2. **Donate** — Anyone sends Bitcoin to the project's escrow address (on-chain, or Lightning that settles into that same address).
3. **Claim** — A builder claims the project once funding hits the claim floor.
4. **Complete** — Reviewers verify the deliverable; keyholders release escrow on success.

## For builders

Watch a project to follow funding — watching does **not** reserve the work. When confirmed escrow meets the claim floor, claim on the project page. That opens a PR in the proposals repo; the exclusive window starts when it merges. Submit the deliverable the same way for public review.

## Lightning donations

Lightning is a **funding rail into on-chain escrow**, not a separate balance. A Boltz reverse swap settles on-chain to the project escrow before the claim floor moves. Unpaid invoices do not count. Signet is on-chain only; Lightning is for mainnet production.

## Key parameters

These numbers are fixed at launch and pulled from [PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md) on every deploy:

- **Submission fee:** {{submission_fee}} — paid when you open a proposal PR; exact and non-refundable.
- **Platform fee:** {{platform_fee}} — paid to Plebly from escrow only when a project completes successfully.
- **Claim floor:** {{minimum_funding_claim_floor}} — minimum escrow balance before a builder can claim.
- **Claim window:** {{claim_window}} after a claim is accepted. {{claim_extension}}.

Milestone splits apply above **{{milestone_threshold}}**. Badge tiers, funding windows, and confirmation counts are documented in PARAMETERS.md.

## Trust model

Escrow is **3-of-5 multisig**. Plebly never holds a spending key. Launch uses human keyholders; there is **no on-chain timelock** in v1.

If keyholders stall after a reviewer-approved release, the public process in the [KEYHOLDERS stall runbook](https://github.com/Plebly/proposals/blob/main/docs/keyholder-stall-runbook.md) applies: a 7-day log followed by a 14-day incident process.

Parameters and the keyholder roster live in git — see [PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md) and [KEYHOLDERS.md](https://github.com/Plebly/proposals/blob/main/KEYHOLDERS.md).

## Testing vs launch

The site is currently on **{{bitcoin_network}}** for end-to-end testing. Launch will use **mainnet only** with 3-of-5 multisig escrow — see [KEYHOLDERS.md](https://github.com/Plebly/proposals/blob/main/KEYHOLDERS.md).

## Get involved

Follow updates on [X @joinplebly](https://x.com/joinplebly) and [GitHub @Plebly](https://github.com/Plebly). Questions, proposals, and corrections belong in the open repo.
