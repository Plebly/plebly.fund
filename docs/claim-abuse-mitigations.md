# Claim abuse mitigations

Risk register and enforcement map for open exclusive claiming (Q7–Q9). Knobs live in [`Plebly/proposals` PARAMETERS.md](https://github.com/Plebly/proposals/blob/main/PARAMETERS.md). Changes require a public process and thirty-day notice.

## Threat model

Plebly’s claim market is permissionless: anyone authenticated may **apply** when escrow meets the floor. Exclusivity is awarded under the proposal’s `claim_mode` (not a blind first-PR race). The main failure mode is **resource monopolization** (exclusivity is valuable; claim cost must not be ~zero), not custody theft of escrow keys.

## Vector → control

| Vector | Control |
|--------|---------|
| Claim farming (claim every open bounty) | Max active claims = 1; claim bond |
| Application spam | Bond on apply; max **10** applications per proposal; **1** open application per identity (incl. org) |
| Slot parking (claim, idle, expire, reclaim) | Bond forfeit; 30-day reclaim cooldown; day-45 checkpoint |
| PR / KV thrash | Pending TTL 72h; one pending/open app per user; max 10 site-claim PRs/day |
| Sybil swarm | Bond + public claim history; identity relink cooldown 7d |
| Proposer never picks (`proposer_select`) | Decision grace then **auto-award earliest bonded** |
| first_bonded sniping | Proposer chose that mode; bond still required |
| Org sock puppets | Org apply requires GitHub session + **Account-linked** admin org (`read:org` once, 90d TTL); 1 open/awarded claim per `github-org:…` |
| Proposer self-deal | Allowed (Q8); **Proposer-claimed** badge |
| Deliverable theater | Public history; reviewer reject + reclaim cooldown |
| Reject-loop grief | Same-project 30-day cooldown after `final_rejected` |
| Payout hop / wash | Public history of outcomes per identity |
| Watch spam | Low severity; not economically gated |
| Applicant / collaborator farming for badges | No badges or reviewer credit for applying or credit-only collaborators |

## Modes (Q9)

| Mode | Award rule |
|------|------------|
| `first_bonded` | First confirmed bond wins immediately |
| `proposer_select` | Window 3/7/14d from claimable; proposer Accept; else auto earliest bonded after 3d grace |

Window starts at **claim floor met**, not at propose time. Bond is verified **synchronously at apply** (v1); there is no separate unconfirmed `pending_bond` settle path.

## Enforcement surfaces

| Surface | Enforces |
|---------|----------|
| **Workers** | Application pool (`claimapp:`), bond verify, floor gate, org admin check, accept/reject authz, cron grace/auto-award, active cap, pending TTL, exact bond/fee verify (`fee-payment.ts`), `paytxid:` anti-replay, durable `claimactive:` + cron lifecycle, daily rate limit, cooldowns, HTTPS checkpoint reachability, suspension flag, claim ledger (retained on delete-account) |
| **Git merge** | Exclusive claim acceptance after award PR; `claimed_at` from merge; deliverable / reject status; CI fee/bond gate |
| **Keyholders** | Bond refunds on `completed` / losing applicants; forfeit accounting; published suspension when criteria met |
| **HOOK_SECRET** | `/claims/outcome`, `/claims/challenge/accept`, `/escrow/allocate`, refundable bonds — not session-auth |

### Routes (applications)

| Method | Path | Who |
|--------|------|-----|
| GET | `/claims/applications` | Public (bond status, timers) |
| POST | `/claims/` or `/claims/applications` | Authenticated applicant |
| POST | `/claims/applications/:id/accept` | Proposer only |
| POST | `/claims/applications/:id/reject` | Proposer only |
| POST | `/claims/applications/:id/withdraw` | Applicant |
| POST | `/claims/collaborators` | Awarded claimer |
| GET | `/claims/github/user-search`, `/following` | Session (invite UX) |
| POST | `/auth/github/link-org` | GitHub session — start `read:org` OAuth; attest admins on profile |
| DELETE | `/auth/github/orgs/:login` | Unlink org attestation |

### Delete-account tombstone

`deleteProfile` removes profile, username, watches, and pending-user index, but **retains** `claimledger:{userId}` (opaque audit / bond history). Orphan keys such as `claimowner:*`, `claimactive:*`, and `claimpending:*` are left for the builder-claim lifecycle cron to clear when windows expire or challenges are accepted. Open `claimappuser:` keys should be cleared on withdraw/award/reject.

## Bond economics

- Amount: `CLAIM_BOND_SATS` (default 10,000); escalates to **2×** after `CLAIM_ABUSE_ESCALATION_THRESHOLD` expired/abandoned outcomes without a completion.
- Destination: fee address (same as submission fee unless published separately).
- Not project escrow — refunds are ops batches, not automatic clawbacks from bounty UTXOs.
- Winner: locked for delivery lifecycle. Losers / rejected / withdrawn: refundable index.

## Explicitly out of scope

- KYC or invite-only claiming
- Staff / funder picking claim winners (beyond proposer in `proposer_select`)
- Bond into project escrow
- Sats-weighted claim priority
- Collaborator operate rights or payout splits
- Silent / undisclosed bans
- Changing `claim_mode` after submit

## Success criteria

1. One identity cannot hold more than one exclusive claim.
2. Farming requires repeated on-chain bonds and accumulates a public failure history.
3. Expiry/reject cannot instantly recycle the same project for the same identity.
4. Pending KV cannot park a claim longer than the pending TTL.
5. Self-deals remain allowed but are visible.
6. Proposer inaction cannot strand bonded applicants (`proposer_select` auto-award).
7. All knobs are in PARAMETERS with 30-day change notice.
