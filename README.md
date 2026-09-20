# plebly.fund

Static frontend for [Plebly](https://plebly.fund).

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

Pushes to `main` build and deploy via GitHub Pages (see `.github/workflows/pages.yml`).

The site uses **path-based SPA routes** (`/propose`, `/about`, `/proposal/…`). The build copies `index.html` to `404.html` so GitHub Pages deep links load the app. Legacy `#/…` URLs redirect to the path equivalent.

LLM / agent discovery: [`/llms.txt`](https://plebly.fund/llms.txt) (curated index) and [`/llms-full.txt`](https://plebly.fund/llms-full.txt) (longer context), per [llmstxt.org](https://llmstxt.org/).

### Custom domain (`plebly.fund`)

Cloudflare DNS should point `@` and `www` CNAME records at `plebly.github.io`. **Set proxy status to DNS only (grey cloud)** — orange cloud breaks GitHub Pages routing and blocks TLS certificate issuance.

## E2E (Playwright)

Donate / claim-chrome smoke against a live or preview URL:

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

Defaults to `PLEBLY_BASE_URL=https://plebly.fund` (listing `PLEBLY-2026-001` → `/p/plebly-2026-001`). Point at a preview to verify a fix before production catches up:

```bash
PLEBLY_BASE_URL=https://your-preview.example npm run test:e2e
```

CI runs this smoke on every PR and **fails the job** if `#donate-modal` does not open after clicking Donate (documents expected behavior from Donate #15–#18).

