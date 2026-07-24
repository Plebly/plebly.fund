# Claim abuse mitigations

Risk register and enforcement map for open exclusive claiming (Q7–Q9). Knobs live in [`Plebly/proposals` PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md). Changes require a public process and thirty-day notice.

## Threat model

Plebly’s claim market is permissionless: anyone authenticated may claim when escrow meets the floor. The main failure mode is **resource monopolization** (exclusivity is valuable; claim cost must not be ~zero), not custody theft of escrow keys.

## Vector → control

| Vector | Control |
|--------|---------|
| Claim farming (claim every open bounty) | Max active claims = 1; claim bond |
| Slot parking (claim, idle, expire, reclaim) | Bond forfeit; 30-day reclaim cooldown; day-45 checkpoint |
| PR / KV thrash | Pending TTL 72h; one pending per user; max 10 site-claim PRs/day |
| Sybil swarm | Bond + public claim history; identity relink cooldown 7d |
| Proposer self-deal | Allowed (Q8); **Proposer-claimed** badge |
| Deliverable theater | Public history; reviewer reject + reclaim cooldown |
| Reject-loop grief | Same-project 30-day cooldown after `final_rejected` |
| Payout hop / wash | Public history of outcomes per identity |
| Watch spam | Low severity; not economically gated |

## Enforcement surfaces

| Surface | Enforces |
|---------|----------|
| **Workers** | Active cap, pending TTL, bond txid verify, spent-txid set, daily rate limit, cooldowns, checkpoints, suspension flag, claim ledger |
| **Git merge** | Exclusive claim acceptance (first merge wins); deliverable / reject status |
| **Keyholders** | Bond refunds on `completed`; forfeit accounting; published suspension when criteria met |

## Bond economics

- Amount: `CLAIM_BOND_SATS` (default 10,000); escalates to **2×** after `CLAIM_ABUSE_ESCALATION_THRESHOLD` expired/abandoned outcomes without a completion.
- Destination: fee address (same as submission fee unless published separately).
- Not project escrow — refunds are ops batches, not automatic clawbacks from bounty UTXOs.

## Explicitly out of scope

- KYC or invite-only claiming
- Staff picking claim winners
- Bond into project escrow
- Sats-weighted claim priority
- Silent / undisclosed bans

## Success criteria

1. One identity cannot hold more than one exclusive claim.
2. Farming requires repeated on-chain bonds and accumulates a public failure history.
3. Expiry/reject cannot instantly recycle the same project for the same identity.
4. Pending KV cannot park a claim longer than the pending TTL.
5. Self-deals remain allowed but are visible.
6. All knobs are in PARAMETERS with 30-day change notice.
