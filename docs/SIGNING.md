# Keyholder signing

One sitting signs the PSBTs already published for structure funding, the selected bounty branch, and a frozen monthly release. The keyholder uses a Ledger over USB or a SeedSigner over animated QR. Each device confirmation is stored immediately. Broadcast is a separate click after the signature threshold.

Bond refunds and contributor refunds are not part of this sitting. Those tabs record a txid after a payment from the refund wallet.

## Optional wallet check

The Sparrow message check is optional. It does not unlock signing or Broadcast.

1. Open Tools, Sign/Verify Message in Sparrow.
2. Sign with the seat receive address, not the project escrow.
3. Paste the signature. The page says whether that address matches the seat.

## Ledger

The browser asks for the public escrow descriptor. If multisig is not configured, the device loop does not start.

On the first connect the page registers that descriptor as a wallet policy. The Ledger shows the policy. If it does not match the wallet you expect, reject it on the device. The browser remembers the policy HMAC for the next visit and registers again only when the device says the HMAC is missing.

The page walks the selected transactions. Before each one, the card on screen changes to that transaction, with the payout address in chunks. Confirm it on the device only if it matches. Cancel leaves signatures that were already stored.

## SeedSigner

The page shows the unsigned transaction as an animated QR. Scan it with the SeedSigner and confirm the outputs on the device. The page camera stays off until you choose Scan the signed QR, so it does not read the QR on this screen. The signature is stored the same way as a Ledger signature. Stop leaves signatures that were already stored.

Use a desktop browser that can talk to a camera. A phone is not the Ledger path.

## Broadcast

When a card has enough signatures, Broadcast is the review step. It does not appear by itself on the last device confirmation.

The click sends the already-signed transaction once. On signet, settlement can finish in that same click. On mainnet the card says the transaction was sent and is waiting for one confirmation. The same button checks again. It does not send a second time, and it does not ask for a txid.

A stolen GitHub session can press Broadcast only after the threshold has already signed that transaction.

Monthly auto-broadcast stays off unless the Worker var `DISBURSE_AUTO_BROADCAST` is `true`.
