## About Plebly

Plebly funds Bitcoin work in public. New listings pay the builder. That payment is final. A listing that already has a multisig escrow keeps it. On signet, Plebly's server never holds keys.

## What we believe

**Plebly's server holds no keys.** Escrow coins stay in a public multisig until keyholders sign. A direct payment goes to the builder and is not held. Lightning donations (when enabled) are held by OpenNode, a custodial processor, until the on-chain sweep.

**Public listings.** Every project and address is visible.

**Published rules.** Fees and payouts are in the open. A direct payment does not take the escrow fee.

## How it works

1. **List:** A bounty for builders or a campaign for a cause.
2. **Donate:** Send Bitcoin to the address on the listing.
3. **Build or receive:** Builders apply, or the organizer receives.
4. **Pay:** Reviewers confirm escrow bounty work before it pays. A direct payment is already with the builder.

Browse [open projects](/) or [start a project](/propose).

## For builders

Watch to follow — it does not reserve the work. On an escrow listing, apply once it is funded. On a direct listing, apply before anyone pays. A bond holds your place. Ship, get reviewed. Escrow pays after an approve. A direct payment is already final.

## Lightning

Paid to OpenNode, a custodial processor, then swept on-chain in batches to the escrow address. A listing that pays the builder does not take Lightning. Counts only after that sweep confirms; unpaid invoices never count. Mainnet only, when enabled.

## Key numbers

These come from the published parameters on **{{bitcoin_network}}**:

- **Submission fee:** {{submission_fee}}
- **Platform fee:** {{platform_fee}}
- **Opens for builders at:** {{minimum_funding_claim_floor}}
- **Time to deliver:** {{claim_window}}. {{claim_extension}}.

## Trust

Keyholders sign escrow payouts. Plebly's server never holds a spending key. On signet, release needs 2 of 3 keyholder signatures on a public multisig script. Keyholders are not yet independent of the operator, and the Knots listing uses an operator-controlled test address. See [Keyholders](#keyholders).

## Testing vs launch

Currently **{{bitcoin_network}}**. Launch is mainnet.

## Get involved

[X @joinplebly](https://x.com/joinplebly) · [GitHub @Plebly](https://github.com/Plebly)
