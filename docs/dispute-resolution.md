# Dispute resolution

Live paths only. Plebly is a coordinator: review + PSBT routing, 3% platform + 2% keyholders, no keys. Review is final. Donors funded a process, not a veto. Keyholders do not re-try quality. AI is optional triage and never releases funds.

“Proposer accepts” means **applicant award**, not quality sign-off. The reviewer seat is earned by completing a bounty (`addEarnedReviewer`). Standard reviews are the unpaid duty of that seat.

## Money

| Who | Pays / receives | Amount | When |
|---|---|---|---|
| Proposer | Submission fee → ops address | 10,000 sats, non-refundable | Propose |
| Builder | Claim bond → ops address | 10,000 sats | Apply |
| Escrow (donors) | Platform cut | 3% of monthly disbursed set | KH release |
| Escrow (donors) | Keyholder cut | 2%, 500k sat cap per signing keyholder | KH release |
| Builder | Bond back | 10k refunded via KH batch | `completed` |
| Builder | Bond gone | Ledger `forfeited` — sats already sat at the fee address at bond verify | Window expiry, checkpoint abandon, rebuttal expiry, final reject, fraud |
| Reviewer | Flag ballot (`deliverable_confirm`) + human listing merge | 0 sats | Duty of the earned seat |
| Reviewer | Finished deliverable review (yes or no) | Equal share of the 2% reviewer reserve, or the reserve refunds to the donor pool | `deliverable_confirm` after it is final, `second_review` |
| Reviewer | Listing challenge, claim extension, AI-only tally | 0 sats | `listing_challenge` and `claim_extension` stay unpaid. An unchallenged AI tally holds the reserve. |
| AI | Ops budget from the 3% | Vendor invoice | First-pass; never billed to proposer/builder |

**Insurance pool:** there is no separate address. Bond verify spends 10k to the submission-fee address. Forfeit is a KV flag. Those sats are mixed with submission fees. The 10,000 sat vote is not paid. A finished human deliverable review can instead be paid from the 2% reviewer reserve.

Not paid: funder removal, contributor ballots (including funding `extend`), KH election, ops-role votes, dissent-without-vote, AI fail, listing merge. Abstain and no-vote pay 0.

## Review process

1. **List.** Fee + `POST /proposals/submit` → `unindexed/` PR. Human merge to `listed/` (not a Worker ⅔ ballot). Q25 reviewer-vs-reviewer challenge is not implemented.
2. **Award.** `first_bonded` or `proposer_select` (pick or auto earliest).
3. **Checkpoint.** Day 45 + 7 grace or forfeit / reopen. Abandoned-claim: contributor challenge + hook accept → same reopen.
4. **Claim extension (optional).** Fulfiller `request-extension` → `claim_extension` ballot. One-shot. Paid later.
5. **Deliverable.** Fulfiller submits (required to close a bounty). Direct: proposer only; drip can still pay without a deliverable.
6. **AI.** Fail → back to builder, no ballot. API down → ambiguous, recorded. Pass/ambiguous never opens a ballot and never releases funds.
7. **Proposer “This is done.”** Bounty only. Requires a deliverable. Opens a 7-day donor flag window. Confirmed contributors on this project are notified. If the proposer never clicks, do not auto-complete.
8. **Donor flag (optional).** One confirmed contributor on this project + written reason (≥40 chars) opens unpaid `deliverable_confirm`. 1-sat strangers cannot flag. No extra donor vote after that.
9. **No flag when the window ends.** Cron auto-`completed` (no `decision_id`) → KH PSBT. Same escrow/payout gates as the outcome hook.
10. **Flag → human `deliverable_confirm` (unpaid).** Pass iff `yes >= ceil(2/3 * roster)` AND `(yes+no) >= 5` AND `yes > 0`. Failed quorum / idle stays pending. Dissent is a git record, not a third appeal.
11. **Reject → 14-day rebuttal.** One `second_review` (paid later). Second reject or expiry → `claimable`, 30-day cooldown, bond forfeit.
12. **Approve → `completed`.** Hook + `decision_id` (`deliverable_confirm` or `second_review` only). Then KH PSBT. `ALLOW_FORCE_OUTCOME` is ops break-glass. Live `single-key-test` 403s this path.

Direct proposals skip award and skip this donor window. Optional deliverable uses AI only. Confirmed escrow can join the monthly drip **without** a deliverable.

## Scenarios

| Scenario | Who decides | Outcome |
|---|---|---|
| No quality fight; proposer picks builder (`proposer_select`) | Proposer (or auto earliest) | Award only. Close still needs a deliverable + done click. |
| `first_bonded` | First confirmed bond | Same. |
| Builder delivers; proposer marks done; donors quiet | Clock (7 days) | Auto-`completed` → KH sign. |
| Builder delivers; proposer marks done; one donor flags | Reviewers ⅔ | `deliverable_confirm` → approve `completed` or reject/rebuttal. |
| AI clear fail | Model (triage) | Back to builder. Not a reject. |
| Reviewers reject; builder silent | Clock | Rebuttal expiry → reopen, bond forfeit. |
| Reviewers reject; builder rebuts; second approve | Reviewers | `completed` → KH. |
| Reviewers reject; builder rebuts; second reject | Reviewers | Final. Reopen, cooldown, bond forfeit. |
| Reviewers idle on an open ballot | Quorum math; no auto-fail | Stays pending. |
| Checkpoint miss / claim window end | Cron / rules | Reopen, bond forfeit. |
| One 30d claim extension | Reviewers | Window moves once. |
| Underfunded or idle 365d | Contributors (1 id = 1 vote) | extend / refund / redirect. KH still sign the spend. |
| Funder challenges listing | Reviewers (`listing_challenge`) | Pass → decline PR. |
| Abandoned-claim challenge | Contributor + hook accept | Reopen, bond forfeit. |
| Funding window +90d | Contributors (`extend`), not reviewers | One-shot `fundext`. |
| Funder removes a reviewer | Eligible funders ⅔ (unpaid) | Seat gone; may re-earn on a later completion. |
| Force-completed | Ops + `ALLOW_FORCE_OUTCOME` | Audited residual. |
| Reviewers approve; KH stall | Published runbook | Seats, not names; replace-and-wait. |
| Direct: proposer is the builder | No donor window | Drip can pay without deliverable. |
| AI API down | Treated as ambiguous | Recorded. No ballot until a donor flags. |

## Keyholder stall (Q21)

Clock starts at `disburse_ready`. Publicity uses seat numbers 1–5, not names. Day 7 public log. Day 14 incident + `/escrow/stall` banner. Replacement: 30-day descriptor notice; the same package waits. No extra donor vote. No on-chain forced exit.

## Unratified appendix

nLockTime twin PSBTs and decaying descriptors are not ratified and are not built. They cannot be added to coins already in `wsh(sortedmulti(3,…))`.
