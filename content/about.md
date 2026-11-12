## About Plebly

Plebly funds Bitcoin work with publicly verifiable on-chain escrow. On signet, Plebly's server never holds keys.

## What we believe

**Plebly's server holds no keys.** Lightning donations (when enabled) are held by OpenNode, a custodial processor, until the on-chain sweep.

**Public listings.** Every project and address is visible.

**Published rules.** Fees and payouts are in the open.

## How it works

1. **List:** A bounty for builders or a campaign for a cause.
2. **Donate:** Send Bitcoin to the public address.
3. **Build or receive:** Builders apply, or the organizer receives.
4. **Pay:** Reviewers confirm bounty work. Campaigns follow the published rules.

Browse [open projects](/) or [start a project](/propose).

## For builders

Watch to follow — it does not reserve the work. Apply when funded. A bond holds your place. Ship, get reviewed, get paid.

## Lightning

Paid to OpenNode, a custodial processor, then swept on-chain in batches to the same escrow address. Counts only after that sweep confirms; unpaid invoices never count. Mainnet only, when enabled.

## Key numbers

These come from the published parameters on **{{bitcoin_network}}**:

- **Submission fee:** {{submission_fee}}
- **Platform fee:** {{platform_fee}}
- **Opens for builders at:** {{minimum_funding_claim_floor}}
- **Time to deliver:** {{claim_window}}. {{claim_extension}}.

## Trust

Keyholders sign payouts. Plebly's server never holds a spending key. On signet, release needs 2 of 3 keyholder signatures on a public multisig script. Keyholders are not yet independent of the operator, and the Knots listing uses an operator-controlled test address. See [Keyholders](#keyholders).

## Testing vs launch

Currently **{{bitcoin_network}}**. Launch is mainnet.

## Get involved

[X @joinplebly](https://x.com/joinplebly) · [GitHub @Plebly](https://github.com/Plebly)
