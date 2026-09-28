# plebly.fund

Static frontend for [Plebly](https://plebly.fund) (mainnet, after cutover) and [signet.plebly.fund](https://signet.plebly.fund) (rehearsal).

Reads listings from the Workers catalog (`VITE_WORKERS_API`) and balances from Mempool.space. GitHub is a fallback, not the live listing path.

### Lightning → escrow

Donors can pay Lightning on mainnet (or staging with `VITE_LIGHTNING_TESTNET=1` + Workers `LIGHTNING_ENABLED=true`). The Workers API creates an OpenNode invoice, accrues paid charges, and sweeps on-chain into the project `escrow_address`. Claim-floor math still uses the mempool address balance — never unpaid invoices. Signet stays on-chain only.

## Develop

```bash
npm install
npm run dev
```

Open `http://localhost:5173/`. The SPA talks to the deployed Workers API by default.

**Local login:** GitHub OAuth `return_to` must be an allowed frontend origin on the Workers API (`localhost` / `127.0.0.1` any port). If login bounces you to `https://plebly.fund`, deploy the workers change that allows local origins, then try again from localhost.

## Deploy

Pushes to `develop` build a signet SPA (`VITE_BITCOIN_NETWORK=signet`, `VITE_WORKERS_API=https://api.signet.plebly.fund`) and `wrangler deploy --env signet`.

Pushes to `main` still deploy the unnamed apex Worker (signet content) until the cutover commit that moves apex routes into `[env.production]` and bakes `VITE_BITCOIN_NETWORK=mainnet` + `VITE_LIGHTNING=0`.

The site uses **path-based SPA routes** (`/propose`, `/about`, `/proposal/…`). The build copies `index.html` to `404.html` so deep links load the app. Legacy `#/…` URLs redirect to the path equivalent.

LLM / agent discovery: [`/llms.txt`](https://plebly.fund/llms.txt) (curated index) and [`/llms-full.txt`](https://plebly.fund/llms-full.txt) (longer context), per [llmstxt.org](https://llmstxt.org/).

### Custom domain (`plebly.fund`)

Apex and `www` are Cloudflare Workers assets (`wrangler.toml` routes). Signet rehearsal is `signet.plebly.fund`. GitHub Pages is not the live site.

## E2E (Playwright)

Donate / claim-chrome smoke against a live or preview URL:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

Defaults to `PLEBLY_BASE_URL=https://signet.plebly.fund` (listing `PLEBLY-2026-001` → `/p/plebly-2026-001`). Point at a preview to verify a fix before production catches up:

```bash
PLEBLY_BASE_URL=https://your-preview.example npm run test:e2e
```

CI runs this smoke on every PR and **fails the job** if `#donate-modal` does not open after clicking Donate (documents expected behavior from Donate #15–#18).

