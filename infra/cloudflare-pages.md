# Cloudflare Pages setup (apps/web)

Use these settings when creating the Cloudflare Pages project:

- Framework preset: `Vite`
- Root directory: `apps/web`
- Build command: `npm ci && npm --workspace @teacheros/web run build`
- Build output directory: `apps/web/dist`
- Node version: `20`

Required environment variables:

- `VITE_API_BASE_URL` (Render API URL, e.g. `https://teacheros-api.onrender.com`)
- `VITE_CLERK_PUBLISHABLE_KEY`
- `VITE_SENTRY_DSN` (optional)

The Render API's `CLERK_AUTHORIZED_PARTIES` value must include
`https://teacher-dashboard-clean.pages.dev`. This lets the API verify Clerk
tokens issued to the Pages deployment.
