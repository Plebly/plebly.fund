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

The domain uses Cloudflare nameservers. In **Cloudflare → plebly.fund → DNS**, add:

| Type  | Name | Content            | Proxy   |
|-------|------|--------------------|---------|
| CNAME | `@`  | `plebly.github.io` | DNS only (grey cloud) |
| CNAME | `www`| `plebly.github.io` | DNS only |

After DNS propagates, add `public/CNAME` containing `plebly.fund`, set the custom domain in GitHub **Settings → Pages** (or `gh api PUT repos/Plebly/plebly.fund/pages -f cname=plebly.fund`), enable **Enforce HTTPS**, and rebuild with `VITE_BASE_PATH=/` in the Pages workflow.

Until DNS is live, use https://plebly.github.io/plebly.fund/
