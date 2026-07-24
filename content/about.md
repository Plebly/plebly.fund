## What Plebly is

Plebly is a public bounty platform for Bitcoin development and research. Proposals live in git. Escrow lives on Bitcoin. No single party can freeze or redirect funds.

Anyone can fork the proposal record. Plebly can decline to list a proposal, but cannot erase it or confiscate its escrow.

## How it works

1. **Submit** — Open a pull request on [Plebly/proposals](https://github.com/Plebly/proposals) and pay the submission fee on-chain.
2. **Fund** — Contributors send Bitcoin to the proposal's escrow address.
3. **Claim** — A builder claims once funding reaches the claim floor.
4. **Complete** — Reviewers verify the deliverable; keyholders release escrow on success.

## Fees and thresholds

The submission fee is **{{submission_fee}}**.

On successful completion, **{{platform_fee}}** is deducted from escrow and sent to the platform operations wallet.

Bounties become claimable at **{{minimum_funding_claim_floor}}** (the claim floor). Milestone splits apply above **{{milestone_threshold}}**.

After a claim is accepted, the builder has **{{claim_window}}** to deliver. Reviewers may grant **{{claim_extension}}**.

## Funding windows and badges

While parameters are still being ratified before launch, the proposed defaults are:

- Active funding window: **{{active_funding_window}}**
- Funding window extension: **{{funding_window_extension}}**
- Idle claimable → contributor ballot: **{{idle_claimable_contributor_ballot}}**
- Notable Contributor badge: **{{badge_notable_contributor}}**
- Major Contributor badge: **{{badge_major_contributor}}**
- Patron badge: **{{badge_patron}}**

Confirmation requirements: submission fee **{{submission_fee_confirmations}}** conf; funding, badges, and votes **{{funding_badge_vote_confirmations}}** conf; completion finality **{{completion_finality_confirmations}}** conf.

## Network

The site is currently running on **{{bitcoin_network}}** for testing. Launch will use mainnet only with 3-of-5 multisig escrow — see [KEYHOLDERS.md](https://github.com/Plebly/proposals/blob/main/KEYHOLDERS.md).

Canonical parameter values live in [PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md). Changes require a public process and thirty-day notice.
