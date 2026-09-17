# Messenger CRM — Facebook Messenger CRM Template

> Self-hostable CRM template for **Facebook Messenger** — shared inbox, contacts, products catalog, sales pipelines, broadcasts, and AI automations. Fork it, brand it, host it.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![Meta Graph API](https://img.shields.io/badge/Meta-Messenger%20Platform-0084FF?logo=facebookmessenger)](https://developers.facebook.com/docs/messenger-platform)

---

## What you get out of the box

- **Facebook Messenger Shared Inbox** — Manage customer conversations via Meta Graph API v25.0, per-conversation assignment, status, and notes.
- **24-Hour Messaging Window Compliance** — Enforces Meta's 24-hour messaging window rule with automated `HUMAN_AGENT` message tags for standard support extension up to 7 days.
- **Products Management Module (For AI Agents)** — Manage catalog items (title, description, price, currency, image URLs, SKU) with card previews for AI agents to present interactive product cards to buyers.
- **Contacts + PSID Resolution** — Automatic Facebook Page-Scoped ID (PSID) resolution, user profile fetching (first name, last name, avatar), tags, and custom fields.
- **Sales Pipelines (Kanban)** — Visual deal stages linked to Messenger conversations.
- **Broadcasts** — Outbound message broadcasts to targeted contact segments within the messaging window.
- **No-Code Automations & Flows** — Trigger on inbound messages, keywords, or postback events with conditional branches, tag actions, and webhooks.
- **AI Reply Assistant** — Contextual auto-replies powered by OpenAI/Anthropic/Gemini with vector RAG knowledge base search.
- **Real-Time Dashboard & Analytics** — Metrics for response times, conversation volume, pipeline value, and notification badges.

---

## Environment Variables Setup

Configure the following variables in `.env.local` or directly in your hosting panel (e.g., Hostinger / Vercel):

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Facebook Messenger Platform Credentials
META_PAGE_ID=your-facebook-page-id
META_PAGE_ACCESS_TOKEN=your-page-access-token
META_VERIFY_TOKEN=your-custom-webhook-verify-token
META_APP_SECRET=your-meta-app-secret

# Token Encryption
ENCRYPTION_KEY=32-character-random-secret-key
```

*Note: Page credentials can also be set up dynamically via the **Settings → Messenger** dashboard tab.*

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/shahin92232-dot/R.F.C-2.git
cd R.F.C-2

# Install dependencies
npm install

# Setup environment variables
cp .env.local.example .env.local

# Run database migrations (Supabase)
npx supabase db push

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to log in.

---

## License

[MIT](./LICENSE). Fork it, brand it, host it.
