# Terms of Service

version: tos-2026-09-13  
published_at: 2026-09-13T00:00:00.000Z

These terms describe how the operator of [plebly.fund](https://plebly.fund) coordinates public Bitcoin funding. They are not legal advice. They do not create a company, charity, partnership, or custody relationship. Process and numeric parameters are published on the site.

## 1. Coordinator, not custodian

Plebly routes proposals, reviews, and unsigned PSBTs. It does not hold signing keys and does not sign release transactions. The Worker constructs unsigned PSBTs for keyholder review and signing, and cannot force a 3-of-5 spend. Donors send bitcoin to a published escrow address. Keyholders sign offline.

## 2. Who accepts these terms

You must accept the current version before you **propose** (including amend) or **apply to claim** a bounty. The signed-in person who submits an org proposal covers that submit. Completing a bounty later seats you as a reviewer without a second application; that completion already accepted these terms at claim (or at propose on a direct).

Anonymous **donate** does not require these terms. Contributor ballot votes and refund-address registration do not.

Keyholder apply requires these terms **and** the published keyholder responsibilities.

Reviewer votes, dissent, keyholder signing, and keyholder election votes require the current version (or the previous version during a 30-day grace after a published bump). Bootstrap and pre-terms seats get no grace.

## 3. Review is final

Donors funded a published process, not a veto. Reviewers decide whether a deliverable meets the proposal. Keyholders do not re-try quality. A listed AI Reviewer, powered by BTCDecoded Intelligence, may analyze a deliverable against its spec. That analysis is advisory, does not vote, and never releases funds.

Standard `deliverable_confirm` votes are unpaid. The reviewer seat is earned by completing a bounty; that seat’s ordinary confirmations are unpaid duty. Dispute ballots (`second_review`, `listing_challenge`, `claim_extension`) are specified at 10,000 sats per yes/no vote from forfeited-bond accounting. That payout is **not live**.

## 4. Fees

- Proposal submission: 10,000 sats, exact, non-refundable, to the published fee address.
- Claim bond: 10,000 sats to the same address. Refunded after `completed`. Forfeited on window expiry, checkpoint abandon, rebuttal expiry, final reject, or fraud.
- Release: 3% platform + 2% keyholders of that month’s disbursed set, with a 500,000 sat cap per signing keyholder, plus 1% to Bitcoin District Initiative on bounty structured-funding completions. No fee on donor or bond refunds.
- Bounty refunds on this architecture go to a single pool address (next receive index on the published escrow descriptor), not per-donor claim-based refunds (replaces Q17 for bounty). Direct campaigns stay on the existing drip / per-donor model.

## 5. Stall and replacement

After reviewers approve, keyholders must sign a Worker-bound package. The stall clock starts at `disburse_ready`. Public notices use **seat numbers**, not names. Day 7: public log. Day 14: incident and site banner. Refusal or unavailability: 30-day descriptor notice, new 3-of-5, same package waits. Plebly cannot force the spend. 3-of-5 can still steal out of band; that residual is published.

## 6. Break-glass

`ALLOW_FORCE_OUTCOME` is an audited ops escape, not a donor veto. Unclaimed refunds stay claimable.

## 7. Version changes

A new version is published in git with `published_at`. Anyone who accepted the immediately previous version may keep using it for 30 days. After that, the next gated write requires a fresh accept. People who never accepted get no grace.

## 8. Contact

Rules, parameters, and this file are public in git. There is no named legal entity and no governing-law clause in this version.
