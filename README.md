# plebly.fund

Static frontend for [Plebly](https://plebly.fund).

Reads proposals from [`Plebly/proposals`](https://github.com/Plebly/proposals) and balances from Mempool.space. Optional Workers API via `VITE_WORKERS_API`.

### Lightning → escrow

Donors can pay Lightning on mainnet (or staging with `VITE_LIGHTNING_TESTNET=1` + Workers `LIGHTNING_ENABLED=true`). The Workers API creates a Boltz reverse swap, holds short-lived claim secrets in KV, and broadcasts the claim tx to the project `escrow_address`. Claim-floor math still uses the mempool address balance — never unpaid invoices.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Pushes to `main` build and deploy via GitHub Pages (see `.github/workflows/pages.yml`).

The site uses **path-based SPA routes** (`/propose`, `/about`, `/proposal/…`). The build copies `index.html` to `404.html` so GitHub Pages deep links load the app. Legacy `#/…` URLs redirect to the path equivalent.

LLM / agent discovery: [`/llms.txt`](https://plebly.fund/llms.txt) (curated index) and [`/llms-full.txt`](https://plebly.fund/llms-full.txt) (longer context), per [llmstxt.org](https://llmstxt.org/).

### Custom domain (`plebly.fund`)

Cloudflare DNS should point `@` and `www` CNAME records at `plebly.github.io`. **Set proxy status to DNS only (grey cloud)** — orange cloud breaks GitHub Pages routing and blocks TLS certificate issuance.
