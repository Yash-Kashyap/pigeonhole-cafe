# The Pigeonhole Café

The Pigeonhole Café is a full-stack web application designed for a fictional mountain café set in an old colonial post office sorting room in Kothi Bagh, Himachal Pradesh. The project pairs tactile, editorial paper aesthetics with modern performance, full WCAG 2.1 AA accessibility, and real-time operations.

---

## Features

- **Tactile Heritage Interface**: Built around postal ledger styling, warm paper tones, deep ink typography (Fraunces serif and Instrument Sans), and brass accents.
- **Interactive Pigeonhole Wall**: A 48-compartment interactive postal grid on the home page mapping physical sorting shelves directly to kitchen signature dishes.
- **High-Performance Menu Explorer**: Browse 240 items with sub-second client-side multi-filtering (dietary badges, allergen exclusions, price tiers), lazy category rendering, and an availability fail-safe.
- **Takeaway Ordering Flow**: Step-by-step takeaway order builder enforcing kitchen order caps per 15-minute slot, customer contact validation, and instant receipt generation.
- **Table Slot Reservations**: A 3-step table booking system with interactive calendar selection, party size controls (up to 8 guests), occasion tagging, and student hour verifications.
- **Community & Gatherings**: Dedicated pages for weekly open mic registrations, student afternoon discount hours (weekdays 3:00 PM – 6:00 PM), private table bookings, and weekend trekker meal plans.
- **Real-Time Owner Dashboard (`/owner`)**: Live operational dashboard connected to PostgreSQL via WebSockets. Counter staff can manage incoming takeaway orders, toggle slot availability, answer customer questions, and view business analytics.
- **AI Café Assistant ("Ask")**: A conversational assistant speaking as an old post office sorting clerk. Equipped with tool-calling capabilities to query the menu, check live table availability, populate reservation cards, and hand off to WhatsApp when needed.

---

## Tech Stack

- **Framework**: Astro 7 (Server-side rendering adapter for Cloudflare Workers)
- **UI Components**: React 19 with strict TypeScript
- **Styling**: Tailwind CSS v4 with custom tokens and typography utilities
- **Database & Realtime**: Supabase PostgreSQL with Row Level Security (RLS) policies and real-time WebSocket subscriptions
- **AI Engine**: A hosted language model on its free tier, called from the server with tool calling
- **Testing & Quality Assurance**: Vitest (unit tests), Playwright (end-to-end browser tests), axe-core (automated WCAG 2.1 AA accessibility checks), ESLint, Prettier
- **Runtime Environment**: Cloudflare Workers with asset binding and KV session storage

---

## Local Setup

### Prerequisites

- Node.js 22.12 or newer (Node 26 supported).
- Google Chrome installed (used by Playwright's Chromium automation channel).

### Installation

1. Clone the repository and navigate into the project directory:
   ```bash
   cd pigeonhole-cafe
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
   _(On Windows workstations where npm scripts encounter execution policy restrictions, run `npm.cmd install`)_
3. Copy the sample environment file to create your local `.env`:
   ```bash
   copy .env.example .env
   ```
   Fill in your local database and API credentials in `.env`. Never commit secrets to version control.
4. Start the local development server:
   ```bash
   node scripts/astro.mjs dev
   ```

_Note on workstation paths: If the directory path contains special characters such as `&`, invoke Node directly with quoted script paths as shown below._

---

## Commands

Run all project tasks using direct Node commands:

- **Start Development Server**:
  ```bash
  node scripts/astro.mjs dev
  ```
- **Type Checking**:
  ```bash
  node scripts/astro.mjs check
  ```
- **Linting**:
  ```bash
  node node_modules/eslint/bin/eslint.js .
  ```
- **Code Formatting Check**:
  ```bash
  node node_modules/prettier/bin/prettier.cjs --check .
  ```
- **Format Code**:
  ```bash
  node node_modules/prettier/bin/prettier.cjs --write .
  ```
- **Unit Test Suite**:
  ```bash
  node node_modules/vitest/vitest.mjs run
  ```
- **Production Build**:
  ```bash
  node scripts/astro.mjs build
  ```
- **Accessibility Audit (axe-core)**:
  ```bash
  node scripts/check-a11y.mjs
  ```
- **Menu System Verification**:
  ```bash
  node scripts/check-menu.mjs
  ```
- **Responsive Layout & Navigation Checks**:
  ```bash
  node scripts/check-pages.mjs
  ```
- **Seed Menu Database**:
  ```bash
  node node_modules/tsx/dist/cli.mjs scripts/import-menu.ts
  ```

---

## Environment Variable Names

| Variable                   | Description                                                     | Exposure        |
| -------------------------- | --------------------------------------------------------------- | --------------- |
| `PUBLIC_SUPABASE_URL`      | Supabase project URL                                            | Public / Client |
| `PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous public API key                               | Public / Client |
| `SUPABASE_URL`             | Server-side Supabase REST endpoint                              | Server / Worker |
| `SUPABASE_SERVICE_KEY`     | Privileged Supabase service role key                            | Secret / Worker |
| `GEMINI_API_KEY`           | API key for the assistant model                                 | Secret / Worker |
| `GEMINI_MODEL`             | Assistant model identifier (see `.env.example` for the default) | Server / Worker |
| `PUBLIC_SITE_URL`          | Canonical base URL of the site                                  | Public / Client |
| `PUBLIC_WHATSAPP_NUMBER`   | Café business contact number (international format)             | Public / Client |
| `PUBLIC_ALLOW_INDEX`       | Indexing control (`true` for production, `false` for staging)   | Public / Client |
| `RATE_LIMIT_SALT`          | Random salt string used for anonymising rate limit hashes       | Secret / Worker |

---

## Project Structure

```text
pigeonhole-cafe/
├── docs/                   # Documentation and client demo script
│   ├── DEMO-SCRIPT.md      # 5-minute client presentation walkthrough
│   └── 99-ROADMAP.md       # Development phases and architectural specifications
├── public/                 # Static assets, favicon, and optimised photography
│   └── img/mood/           # Compressed AVIF and WebP mood imagery
├── scripts/                # Node build and validation scripts
│   ├── astro.mjs           # Direct Astro CLI invoker
│   ├── check-a11y.mjs      # Playwright + axe-core WCAG 2.1 AA test runner
│   ├── check-menu.mjs      # Menu performance, filter, and keyboard validator
│   └── check-pages.mjs     # Responsive layout and title checks
├── src/
│   ├── components/         # Astro and React UI components
│   │   ├── assistant/      # AI chat dialog, action cards, and speech hook
│   │   ├── owner/          # Kitchen queue, slot manager, and questions editor
│   │   ├── CartButton.tsx  # Dynamic header cart counter
│   │   ├── MenuExplorer.tsx# Virtualised 240-item menu browser
│   │   ├── PigeonholeGrid.astro # Tactile 48-slot postal pigeonhole wall
│   │   └── ReserveFlow.tsx # 3-step table reservation engine
│   ├── data/               # Static menu items and signature dish definitions
│   ├── layouts/            # BaseLayout with metadata and analytics headers
│   ├── lib/                # Core business rules, validation schemas, and clients
│   │   ├── rules.ts        # Opening hours, slot capacity, and holiday calendar
│   │   ├── cart.ts         # Cart calculation and persistence logic
│   │   └── assistant/      # Assistant prompt, tools, service and provider client
│   ├── pages/              # Astro file-based routes
│   │   ├── index.astro     # Home page
│   │   ├── menu.astro      # Full menu explorer
│   │   ├── order.astro     # Takeaway order checkout
│   │   ├── reserve.astro   # Slot reservation flow
│   │   ├── gatherings.astro# Community events and student discounts
│   │   ├── trek-stop.astro # Weekend hiker meals and trail planner
│   │   ├── visit.astro     # Location, map, hours, and FAQ
│   │   ├── story.astro     # Café history and sorting room origins
│   │   └── owner/          # Role-gated owner dashboard pages
│   └── styles/             # Global CSS and Tailwind tokens
└── wrangler.jsonc          # Cloudflare Worker deployment manifest
```

---

## How the Café Assistant Works

The café assistant ("Ask") sits in the lower corner of public pages and provides immediate, context-aware answers to guest inquiries.

1. **Character & Personality**: The assistant takes on the persona of an attentive clerk working in the old sorting room—courteous, direct, and grounded in café facts. It never invents dishes, prices, or operating rules.
2. **Function Calling Architecture**:
   - `getMenu()`: Accesses live menu items, prices, ingredients, and allergen tags.
   - `checkAvailability(date, partySize)`: Checks table slots against live database bookings.
   - `addToCart(itemId, quantity)`: Inserts items into the customer's cart and renders an interactive action card inside chat.
   - `proposeReservation(date, time, partySize)`: Constructs a structured booking proposal card that the guest can confirm in one click.
3. **Business Rules Enforcement**: The assistant respects all constraints defined in `src/lib/rules.ts` (e.g. closed Mondays, operating hours 08:00–21:30 Tue–Fri and 08:00–23:00 Sat–Sun, 30-day reservation horizon, and student hour discount windows).
4. **Knowledge Loop**: Any customer question the model cannot answer with certainty is automatically stored in the `unanswered_questions` table. Café staff can provide answers in `/owner/questions`, immediately expanding the assistant's knowledge base.
5. **Handoff Mechanism**: If an enquiry requires human coordination or complex catering arrangements, the assistant presents a direct link to chat with floor staff over WhatsApp.

---

## Deploy to Cloudflare Workers

1. Set `PUBLIC_SITE_URL` to the production origin, `PUBLIC_ALLOW_INDEX` to `true` only when public indexing is intended, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `PUBLIC_WHATSAPP_NUMBER`, and `GEMINI_MODEL` in the Cloudflare Worker settings.
2. Build the Worker:
   ```bash
   node scripts/astro.mjs check
   node scripts/astro.mjs build
   ```
3. Authenticate Wrangler:
   ```bash
   node node_modules/wrangler/bin/wrangler.js login
   ```
4. Add each secret when prompted:
   ```bash
   node node_modules/wrangler/bin/wrangler.js secret put SUPABASE_SERVICE_KEY
   ```
   Repeat for `GEMINI_API_KEY` and `RATE_LIMIT_SALT`.
5. Deploy:
   ```bash
   node node_modules/wrangler/bin/wrangler.js deploy
   ```

`wrangler.jsonc` contains only Worker configuration. Never put secret values there. The configured Worker uses the Cloudflare assets binding produced by the Astro adapter.

## Runtime Secrets

Set `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`, and `RATE_LIMIT_SALT` as Worker secrets with `wrangler secret put <NAME>` or in the Cloudflare dashboard. Keep them out of `wrangler.jsonc` and browser code.

For local Wrangler development, put the same values in `.dev.vars`. That file is ignored by Git. Astro development reads local `.env` values.
