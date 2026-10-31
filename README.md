# ThinkMate — Personal AI Thinking Partner & SaaS Platform

**ThinkMate** is a production-grade personal AI thinking partner and collaborative reasoning SaaS platform inspired by the problem-understanding experience of co-thinking. It helps individuals and teams navigate difficult technical, strategic, and architectural decisions by clarifying root problems, decomposing constraints, exploring distinct alternatives, challenging unproven assumptions, and turning user-approved conclusions into concrete action plans.

Unlike generic chatbots that rush to generate shallow answers, ThinkMate enforces an adaptive, stateful cognitive workflow with structured insight synthesis, plan-aware metered quotas, team collaboration, and defense-in-depth security.

---

## 🚀 Key Features

### 1. Multi-Surface User Experience
- **Public SaaS Landing Page (`/`)**: Modern high-converting marketing shell featuring an interactive `HeroDemo` visualizing ThinkMate's guided reasoning cycle in real time.
- **Classic Co-Thinker Workbench (`/app`)**: The full-fidelity 5-mode interactive workbench with real-time SSE streaming, options-matrix comparison, and decision export.
- **Guided Workspaces (`/thinkmate`, `/thinkmate/[id]`)**: Problem-frame-centric workspaces with stage progression (8 stages), evidence linking, live usage meters, and collaborator invites.
- **Self-Service Account & Billing (`/account`, `/pricing`)**: Transparent plan tiers, real-time usage meters, subscription management, and complete self-service account deletion.
- **Team Collaboration (`/invite/[token]`)**: Secure token-based workspace invitations for Team-tier workspaces with 7-day expiration and atomic member enrollment.

### 2. Stateful Cognitive Workflow & Guardrails
- **Understand**: Clarifies the true goal, separates surface symptoms from root constraints, and asks targeted probing questions.
- **Explore**: Divergent ideation. Generates genuinely distinct architectural approaches with explicit principles, trade-offs, and required dependencies.
- **Challenge**: Adversarial stress-testing. Audits assumptions, categorizing them as `[VERIFIED FACT]` vs `[UNPROVEN ASSUMPTION]`, modeling failure modes.
- **Decide**: Convergent evaluation. Weighs alternatives against explicit user criteria and requests explicit acceptance, rejection, or modification.
- **Act**: Execution planning. Formulates immediate next actions (24–48h), verifiable milestones, stop conditions, and definition of done.
- **Workflow State Machine**: Server-side Zod validation prevents premature convergence (e.g. jumping from *Understand* directly to *Act* without exploring alternatives).

### 3. Tiered Plans & Plan-Aware Metered Quotas
- **Tier Entitlements**:
  - **Free**: 30 turns/day, 3 workspaces, 3 research searches/day.
  - **Pro**: 300 turns/day, 100 workspaces, 30 research searches/day, export & evidence tracking.
  - **Team**: 1000 turns/day, 500 workspaces, 100 research searches/day, shared workspaces & collaborator invitations.
- **Atomic User-Level Lock Serialization**: Quota reservation (`tm_reserve_turn_quota_for_plan`) acquires an explicit row lock (`FOR UPDATE` on `tm_user_quotas`) across all workspaces owned by the user, preventing concurrent requests across different workspaces from racing past the daily cap.
- **Fail-Closed Quota Protection**: In production, reservation failures fail closed (`503 Service Unavailable`) rather than bypassing limits via legacy counts.

### 4. Razorpay Subscription Billing
- Fully integrated server-side Razorpay subscriptions (`/api/billing/checkout`).
- Idempotent, signature-verified webhook handler (`/api/billing/webhook`) tracking events in `billing_events` and updating `billing_subscriptions`.
- Out-of-order event protection and self-service cancellation with grace period retention (`/api/billing/cancel`).

### 5. Legal & Privacy Compliance (DPDP Act 2023)
- Explicit user consent tracking table (`user_consents`, migration `010_consents.sql`).
- Terms & Age Confirmation checkboxes enforced on signup.
- Comprehensive, legally compliant [`/terms`](src/app/terms/page.tsx) and [`/privacy`](src/app/privacy/page.tsx) documentation detailing subprocessors, cookie policies, and data rights.
- Self-service account deletion (`/api/account/delete`) verifying credentials, canceling active billing subscriptions, purging database rows via cascade, and clearing session cookies.

### 6. Official Google GenAI SDK & MCP Server
- Powered by `@google/genai` (Gemini 3.5 Flash Lite default, with support for `gemini-3.8-flash` and `gemini-2.5-pro`).
- Official **Model Context Protocol (MCP)** server (`mcp-server/index.ts`) providing 6 tools (including `execute_thinking_turn`) allowing external agents (Cursor, Claude Desktop) to operate directly against ThinkMate workspaces.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router with Turbopack)
- **Language**: TypeScript (Strict type checking with 0 compilation errors)
- **Styling**: Tailwind CSS v4 with curated dark workspace palette (`#090D16` slate/navy) & Framer Motion
- **AI SDK**: `@google/genai` (Official Google GenAI SDK)
- **Database & Auth**: Supabase PostgreSQL with Row Level Security (RLS) & GoTrue Auth
- **Billing**: Razorpay Node SDK
- **Rate Limiting**: Distributed sliding-window limiter via Upstash Redis with fail-closed production semantics
- **Validation**: Zod schema validation & strict JSON payload limits
- **Testing**: Node.js Native Test Runner (`tsx --test`), Playwright E2E, and live PostgreSQL staging verification suites

---

## 📁 Project Architecture

```
thinkmate/
├── .github/
│   ├── dependabot.yml                 # Automated weekly security updates
│   └── workflows/
│       ├── ci.yml                     # PR verification (Lint, Typecheck, Test, Build, Browser E2E)
│       └── staging-verification.yml   # Live PostgreSQL concurrency, RPC, and RLS verification
├── e2e/
│   ├── local/                         # Local Playwright suites (auth, session, refresh-race, cloud-recovery)
│   ├── staging/                       # Live staging suites (staging.spec.ts, thinkmate.spec.ts)
│   └── support/                       # MockBackend, test helpers, and app fixture
├── mcp-server/
│   └── index.ts                       # Model Context Protocol (MCP) server & reasoning tools
├── scripts/
│   ├── apply-tm-migrations.ts         # Fail-safe database migration runner with RLS audit gate
│   ├── check-production-env.ts        # Production environment validator with Redis ping
│   ├── verify-staging-rpc.ts          # Cross-workspace concurrency & user-level lock suite
│   ├── verify-supabase-staging.ts     # Staging database verification suite
│   └── verify-billing-webhook.ts      # Billing webhook verification script
├── src/
│   ├── app/
│   │   ├── page.tsx                   # Public marketing SaaS landing page with HeroDemo
│   │   ├── app/page.tsx               # Classic interactive cothinker workbench
│   │   ├── login/page.tsx             # Standalone login page with ?next= redirect preservation
│   │   ├── forgot-password/page.tsx   # Password reset request page
│   │   ├── reset-password/page.tsx    # Password reset completion page
│   │   ├── pricing/page.tsx           # SaaS subscription pricing tiers (Free, Pro, Team)
│   │   ├── account/page.tsx           # User account & subscription dashboard
│   │   ├── invite/[token]/page.tsx    # Workspace invitation acceptance page
│   │   ├── terms/page.tsx             # Terms of Service (DPDP Act 2023 compliant)
│   │   ├── privacy/page.tsx           # Privacy Policy & Subprocessor disclosures
│   │   ├── robots.ts & sitemap.ts     # Dynamic search engine discovery metadata
│   │   ├── thinkmate/                 # Workspaces list, CreateWorkspaceForm, UsageMeter
│   │   │   └── [id]/                  # Workspace, ThinkingPanel, EvidencePanel, InviteModal
│   │   └── api/
│   │       ├── account/               # Usage inspection & account deletion endpoints
│   │       ├── auth/                  # login, signup, refresh, logout, forgot, reset
│   │       ├── billing/               # checkout, webhook, cancel
│   │       ├── cothink/               # 8-step cognitive engine
│   │       ├── thinkmate/             # workspaces, turns, frames, evidence, decisions, invites
│   │       └── health/                # Liveness & readiness probes
│   ├── components/
│   │   ├── marketing/                 # HeroDemo interactive card
│   │   ├── modals/                    # AuthModal, SettingsModal, DecisionSummaryModal
│   │   └── thinking/                  # ModeSelector, OptionsMatrix, Workspace
│   └── lib/
│       ├── billing/                   # Razorpay client & plan tier definitions
│       ├── legal.ts                   # User consent recording helper
│       ├── supabase-admin.ts          # Guarded service-role client (server only, whitelist tested)
│       └── thinkmate/api-client.ts    # Client fetch wrapper with transparent session refresh
└── supabase/
    └── migrations/                    # Numbered migrations (001–013) with tracking table
```

---

## 🔒 Security Architecture

1. **Guarded Service-Role Isolation**:
   - `src/lib/supabase-admin.ts` provides a guarded admin client strictly disabled from persisting browser sessions.
   - Guarded by an automated test (`src/lib/supabase-admin.test.ts`) that scans all TypeScript files and fails if `supabase-admin` is imported outside the strict server whitelist.

2. **Defense-in-Depth Authentication**:
   - Authentication tokens are maintained in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
   - Session inspection (`GET /api/auth/session`) is strictly read-only. Token rotation occurs exclusively via `POST /api/auth/refresh`.
   - Inflight promise deduplication in `apiFetch` transparently handles access token expiration without dropping active user turns.
   - Login endpoints enforce per-email rate limiting (8 attempts per 15 minutes) and sanitized, non-leaking error responses.

3. **HTTP Security Headers & CSRF**:
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains` enforced in production.
   - Mutating routes verify `Origin` / `Referer` and reject cross-site `Sec-Fetch-Site` requests (`src/proxy.ts`), with explicit exemptions only for verified payment webhooks (`/api/billing/webhook`).

4. **Database Row Level Security (RLS)**:
   - All 14 database tables (`tm_workspaces`, `tm_items`, `tm_frames`, `tm_evidence`, `tm_decisions`, `tm_events`, `tm_members`, `tm_user_quotas`, `user_consents`, `plan_limits`, `billing_subscriptions`, `billing_events`, `tm_invites`) have Row Level Security enabled with explicit tenant policies.
   - CI gating ensures no migration can disable RLS or omit active policies.

---

## ⚡ Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Populate the required credentials:
```env
# AI Provider
GEMINI_API_KEY=your_gemini_api_key_here

# Supabase (Database & Auth)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Distributed Rate Limiting (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://your-upstash-instance.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_rest_token

# Session Encryption Key (min 32 bytes)
SESSION_ENCRYPTION_KEY=your_random_32_byte_base64_string

# Razorpay Billing (Test or Live)
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_ID=rzp_test_xxxx
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
RAZORPAY_PLAN_PRO=plan_pro_xxxx
RAZORPAY_PLAN_TEAM=plan_team_xxxx
```

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) for the SaaS landing page, or [http://localhost:3000/app](http://localhost:3000/app) for the workbench.

---

## 🧪 Testing & Verification Suites

ThinkMate features a comprehensive 5-tier test architecture:

```bash
# Tier 1: Unit, Security & Protocol Tests (234 tests across 37 suites, zero network dependencies)
npm test

# Tier 2: Static Code Quality & Build Verification
npm run lint             # ESLint (0 errors, 0 warnings enforced)
npx tsc --noEmit         # Strict TypeScript type check
npm run build            # Next.js Turbopack production compilation
npm run audit:ci         # Dependency advisory gate

# Tier 3: Browser E2E Tests (Playwright with mocked Supabase/Gemini)
npx playwright install chromium    # First time setup
npm run test:e2e                   # Runs all local browser E2E specs

# Tier 4: Live Staging Database & RLS Concurrency Verification
npx tsx scripts/verify-staging-rpc.ts        # Quota serialization under concurrency & user-level locks
npx tsx scripts/verify-supabase-staging.ts   # Staging OCC, duplicate hashes & atomic rollback
npx tsx scripts/apply-tm-migrations.ts       # Fail-safe migration runner & 14-table RLS gate

# Tier 5: External Model Context Protocol (MCP) Verification
npm run verify:mcp:mock  # Mocked MCP protocol assertions
npm run verify:mcp:live  # Live MCP client turn execution against Gemini & staging DB
```

---

## 🤖 Model Context Protocol (MCP) Server

ThinkMate includes an official Model Context Protocol (MCP) server under [`mcp-server/index.ts`](mcp-server/index.ts) allowing external AI clients (Claude Desktop, Cursor) to manage workspaces and run reasoning turns.

### Available Tools

| Tool | Purpose |
|---|---|
| `list_thinking_workspaces` | Lists accessible ThinkMate workspaces for the authenticated user. |
| `create_thinking_workspace` | Provisions a new workspace for a problem frame with tenant isolation. |
| `get_thinking_context` | Retrieves the confirmed problem frame, verified claims, and active items. |
| `propose_thinking_update` | Proposes new items or problem frame updates for user review with atomic error checks. |
| `list_open_questions` | Returns unverified hypotheses, counterarguments, and unresolved questions. |
| `execute_thinking_turn` | **Direct AI Reasoning**: Runs ThinkMate's guided problem-solving workflow and records outputs atomically under plan quotas. |

### Running the Server
```bash
npm run start:mcp        # Port 3333 by default
npm run dev:mcp          # Watch mode with hot reloading
```

### Claude Desktop Integration (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "thinkmate": {
      "url": "http://localhost:3333/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_SUPABASE_ACCESS_TOKEN"
      }
    }
  }
}
```

---

## 🚢 Production Deployment

1. **Environment Audit**: Validate production configuration with `--ping` to verify Redis connectivity without printing secrets:
   ```bash
   npm run check:env -- --ping
   ```
2. **Database Migrations**: Numbered migrations `001` through `013` are managed by `scripts/apply-tm-migrations.ts`. To apply to a target database, provide `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN`.
3. **Health & Readiness Checks**:
   - `GET /api/health` — Basic liveness probe (200 OK while process is up).
   - `GET /api/health?readiness=true` — Deep readiness probe verifying database connectivity, AI service availability, and Redis auth infrastructure (returns 503 if any dependency is degraded).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
