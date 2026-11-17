# The Pigeonhole Café

A fictional café demo built with Astro, React, strict TypeScript, Tailwind CSS v4, Cloudflare Workers and Supabase. Phase 0 provides the shared design system, business rules, database clients and test foundation.

## Setup

1. Install Node.js 22.12 or newer. This workstation uses Node 26.
2. Run `npm.cmd install` from this folder. The lockfile pins the dependency tree.
3. Copy `.env.example` to `.env` and fill it locally. Never commit `.env`.
4. Keep Google Chrome installed. Playwright uses its Chromium-based `chrome` channel on this Node 26 workstation.
5. Start development with `node scripts/astro.mjs dev`.

The path contains `&`, so the direct Node commands below are the reliable commands on this machine.

## Commands

- Develop: `node scripts/astro.mjs dev`
- Type check: `node scripts/astro.mjs check`
- Lint: `node node_modules/eslint/bin/eslint.js .`
- Format check: `node node_modules/prettier/bin/prettier.cjs --check .`
- Unit tests: `node node_modules/vitest/vitest.mjs run`
- Build: `node scripts/astro.mjs build`
- Browser checks: keep `node scripts/astro.mjs dev --host 127.0.0.1` running in one terminal, then run `node scripts/check-kit.mjs` in another
- Verify menu seed: `node node_modules/tsx/dist/cli.mjs scripts/import-menu.ts`

The internal `/_kit` route is an unlinked, noindex component reference. It is not a public café page.

## Environment variable names

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `PUBLIC_SITE_URL`
- `PUBLIC_WHATSAPP_NUMBER`
- `PUBLIC_ALLOW_INDEX`
- `RATE_LIMIT_SALT`

Deployment is intentionally outside Phase 0. Current Astro releases target Cloudflare Workers through the official adapter.

## Runtime secrets

Set `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, and `RATE_LIMIT_SALT` as Worker secrets with `wrangler secret put <NAME>` or in the Cloudflare dashboard. Keep them out of `wrangler.jsonc` and browser code.

For local Wrangler development, put the same values in `.dev.vars`. That file is ignored by Git. Astro development reads local `.env` values.
