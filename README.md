# plebly.fund

Static frontend for [Plebly](https://plebly.fund).

Reads proposals from [`Plebly/proposals`](https://github.com/Plebly/proposals) and balances from Mempool.space. Optional Workers API via `VITE_WORKERS_API`.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Pushes to `main` build and deploy via GitHub Pages (see `.github/workflows/pages.yml`).

### Custom domain (`plebly.fund`)

Cloudflare DNS should point `@` and `www` CNAME records at `plebly.github.io`. **Set proxy status to DNS only (grey cloud)** — orange cloud breaks GitHub Pages routing and blocks TLS certificate issuance.
