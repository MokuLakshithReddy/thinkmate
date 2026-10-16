# ThinkMate — Personal AI Thinking Partner

**ThinkMate** is a production-minded personal AI thinking partner inspired by the collaborative problem-understanding experience of co-thinking. It helps individuals think through difficult technical, strategic, and architectural dilemmas by clarifying goals, decomposing problems, exploring distinct alternatives, challenging unproven assumptions, and turning user-approved conclusions into concrete action plans.

Unlike generic chatbots that rush to generate shallow answers, ThinkMate enforces an adaptive, stateful 5-mode cognitive workflow.

---

## 🚀 Key Features

1. **Stateful 5-Mode Thinking Workflow**:
   - **Understand**: Clarifies the true goal, separates surface symptoms from root constraints, and asks targeted probing questions.
   - **Explore**: Divergent ideation. Generates genuinely distinct architectural approaches with explicit principles, trade-offs, risks, and required dependencies.
   - **Challenge**: Adversarial stress-testing. Audits assumptions, categorizing them as `[VERIFIED FACT]` vs `[UNPROVEN ASSUMPTION]`, modeling failure modes.
   - **Decide**: Convergent evaluation. Weighs alternatives against explicit user criteria and requests explicit acceptance, rejection, or modification.
   - **Act**: Execution planning. Formulates immediate next actions (24–48h), verifiable milestones, stop conditions, and definition of done.

2. **Server-Side Guardrails & State Machine**:
   - Prevents premature convergence (e.g., jumping from *Understand* directly to *Act* without exploring alternatives or securing user approval).
   - Validates state transitions via server-side Zod schemas (`/api/workflow/transition`).

3. **Official Google GenAI Integration**:
   - Powered by `@google/genai` using Gemini 2.5 Flash / Flash Lite.
   - Server-side streaming via Server-Sent Events (SSE) with structured metadata event protocol (`/api/think/stream`).
   - Grounded reasoning: No fabricated citations, statistics, or imaginary benchmarks.
   - Resilient offline simulator fallback for automated tests and offline development.

4. **Structured Insight & Decision Panel**:
   - Collapsible artifact panel categorizing Goals, Assumptions, Options, Decisions, and Action Items.
   - Interactive options-matrix comparison view with side-by-side trade-off inspection.
   - Decision synthesis generator exporting full markdown reports.

5. **Security & Row Level Security (RLS)**:
   - Supabase PostgreSQL schema with RLS policies ensuring users only access their own sessions (`auth.uid() = user_id`).
   - IDOR prevention and ownership verification on all session mutation endpoints.
   - Model API keys and privileged credentials strictly contained on the server.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router with Turbopack)
- **Language**: TypeScript (Strict type checking, zero `any` policy)
- **Styling**: Tailwind CSS v4 with dark workspace aesthetic (deep navy `#090D16`, subtle cyan accents, slate borders)
- **AI SDK**: `@google/genai` (Official Google GenAI SDK, Gemini 2.5 Flash / Flash Lite)
- **Database & Auth**: Supabase PostgreSQL with Row Level Security (RLS) & GoTrue Auth
- **Rate Limiting**: Distributed sliding-window limiter via Upstash Redis with bounded in-memory fallback
- **Validation**: Zod schema validation & strict JSON bounds (64KB payload limits)
- **Testing**: Node.js Native Test Runner with `tsx` (84 unit tests & live staging database verification suite)

---

## 📁 Project Architecture

```
thinkmate/
├── .github/
│   └── workflows/
│       ├── ci.yml                     # Automated Lint, Typecheck, Test & Build CI
│       └── staging-verification.yml   # Live PostgreSQL concurrency & RLS verification
├── scripts/
│   └── verify-supabase-staging.ts     # Live staging verification suite (concurrency, rollback, RLS)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts     # Secure credential authentication & HttpOnly cookie issuance
│   │   │   │   ├── logout/route.ts    # Authoritative GoTrue server-side revocation & cookie purge
│   │   │   │   ├── refresh/route.ts   # Distributed rate-limited token rotation & race recovery
│   │   │   │   ├── session/route.ts   # Pure read-only session state inspection (GET)
│   │   │   │   └── signup/route.ts    # Email confirmation verification
│   │   │   ├── cothink/route.ts       # Authoritative server-side 8-step workflow engine
│   │   │   ├── demo/cothink/route.ts  # Isolated reasoning simulator for guests
│   │   │   ├── health/route.ts        # Dependency probing & readiness checks without secret leakage
│   │   │   ├── insights/route.ts      # Decision, assumption, and tradeoff records
│   │   │   ├── sessions/route.ts      # Cloud session CRUD with strict user ownership validation
│   │   │   ├── think/stream/route.ts  # SSE streaming endpoint with mode & decision gates
│   │   │   └── workflow/transition/route.ts # Mode transition state machine
│   │   ├── globals.css                # Dark workspace theme tokens
│   │   ├── layout.tsx                 # App shell layout
│   │   └── page.tsx                   # Main workbench container with offline guest segregation
│   ├── components/
│   │   ├── layout/                    # AppHeader, SessionSidebar, InsightPanel
│   │   ├── thinking/                  # ModeSelector, ThinkingWorkspace, OptionsMatrix, SuggestedQuestions
│   │   ├── modals/                    # NewSessionModal, SettingsModal, DecisionSummaryModal, AuthModal
│   │   ├── home/                      # HomeDashboard
│   │   └── ui/                        # Button, Card, Badge, Modal
│   ├── services/
│   │   ├── ai/                        # GeminiThinkingService, prompts, schemas
│   │   ├── db/                        # SupabaseThinkingRepository, repository.ts, client
│   │   └── workflow/                  # WorkflowStateMachine, stage derivation, guardrails
│   ├── lib/                           # server-auth, rate-limiter, csrf, request-utils
│   ├── config/                        # models.ts (supported Gemini models allowlist)
│   ├── proxy.ts                       # CSRF defense middleware & Nonce-based CSP
│   └── types/                         # Domain types, workflow stages, and mode definitions
└── supabase/
    └── migrations/
        ├── 20261012000000_thinkmate_schema.sql # Core schema, RLS policies, tables
        └── 20261013000000_concurrency_and_idempotency_hardening.sql # OCC, FOR UPDATE RPCs
```

---

## 🔒 Security Architecture

1. **Defense-in-Depth Authentication**:
   - Authentication tokens are maintained strictly in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
   - Session inspection (`GET /api/auth/session`) is purely read-only and never sets cookies or rotates tokens.
   - Token rotation is executed exclusively via dedicated, CSRF-validated `POST /api/auth/refresh`.
   - In-memory token rotation grace windows are indexed via SHA-256 hashes (`hashTokenKey`), preventing plaintext tokens from resting in process memory.
   - Logout invokes authoritative server-side session termination against GoTrue via admin APIs or authenticated HTTP endpoints before clearing client cookies.
   - Refresh race recovery only reports success when it can issue the rotated cookies (recovered from the shared Redis rotation record). Otherwise it returns `401` (`REFRESH_ROTATION_UNRECOVERABLE` when the access token is still valid, without clearing cookies a concurrent response may have just rotated).
   - Login, signup, and refresh rate limits use the distributed Upstash limiter (`checkRateLimitAsync`). In production, missing Redis configuration or a Redis outage rejects these requests with `503`; there is no per-instance fallback for auth.

2. **CSRF Policy**:
   - Cookie-authenticated mutations (`/api/*` POST/PUT/PATCH/DELETE) require `Sec-Fetch-Site` not `cross-site` and an `Origin` (or `Referer`) matching the request host or a configured origin (`APP_URL`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_ORIGINS`, Vercel URLs). Enforced by `src/proxy.ts` and each mutating route.
   - Credential-entry routes (`POST /api/auth/login`, `POST /api/auth/signup`) enforce the same origin check **even without cookies** (login CSRF), and require `Content-Type: application/json` (`415` otherwise), which HTML forms and no-preflight cross-origin fetches cannot send.

3. **Database Concurrency & PostgreSQL RLS**:
   - Optimistic concurrency control (OCC) is enforced inside PostgreSQL via `record_workflow_step_tx` and `transition_workflow_mode_tx` with row-level `FOR UPDATE` locking.
   - Idempotency is enforced by persistent composite keys `(user_id, session_id, client_request_id)` with request-payload SHA-256 validation.
   - Strict Row Level Security policies guarantee multi-tenant isolation across `thinking_sessions`, `session_messages`, `session_insights`, `workflow_transitions`, and `workflow_idempotency_keys`.

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
Add your credentials:
```env
GEMINI_API_KEY=your_gemini_api_key_here
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```
That is enough for local development: without Redis the rate limiter uses per-process memory, and the token-rotation key is derived locally. Production needs more; see [Deployment Checklist](#-deployment-checklist).

### 3. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run Automated Test Suites
```bash
# Unit & integration test suite
npm test

# Linter verification (0 errors, 0 warnings)
npm run lint

# TypeScript verification
npx tsc --noEmit

# Production Turbopack build
npm run build

# Staging database verification suite
npx tsx scripts/verify-supabase-staging.ts

# Browser E2E (starts `next dev` on :3100; Supabase-backed APIs and Gemini are mocked per test,
# the guest simulator and CSRF checks hit the real local server)
npx playwright install chromium   # first run only
npm run test:e2e

# Browser E2E against a deployed app (real Supabase/Redis/Gemini, nothing mocked)
E2E_BASE_URL=https://staging.example.com E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... npm run test:e2e

# Full dependency audit gate (dev + prod)
npm run audit:ci
```

---

## 🚢 Deployment Checklist

Production authentication **fails closed**: if Upstash Redis is missing or unreachable, `/api/auth/login`, `/api/auth/signup` and `/api/auth/refresh` return `503` rather than falling back to per-instance limits. Every variable below is documented in [`.env.example`](.env.example).

1. **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; migrations in `supabase/migrations/` applied. Do not set any `STAGING_SUPABASE_*` variable in production.
2. **Gemini**: `GEMINI_API_KEY` (or `GOOGLE_API_KEY`).
3. **Upstash Redis**: `UPSTASH_REDIS_REST_URL` (https) and `UPSTASH_REDIS_REST_TOKEN`. Shared by every instance for rate limits and refresh-token rotation recovery.
4. **Token-rotation key**: `SESSION_ENCRYPTION_KEY`, a dedicated secret of at least 32 bytes (`openssl rand -base64 48`), identical on every instance.
5. **Canonical URL and origins**: `APP_URL` / `NEXT_PUBLIC_APP_URL` set to the public `https://` origin. Add any other domains that legitimately send mutations to `TRUSTED_ORIGINS` (comma-separated, no wildcards).
6. **Client IP / proxies**: on Vercel the defaults are correct. Behind Cloudflare set `TRUSTED_PROXY_PROVIDER=cloudflare`; behind nginx set `TRUSTED_PROXY_PROVIDER=nginx` (or `TRUSTED_PROXY_HEADER=x-real-ip`); with extra proxy hops set `TRUSTED_PROXY_DEPTH`.
7. **Validate the configuration** with the production values before releasing. This exits non-zero on any error, never prints values, and `--ping` checks the Redis credentials:
   ```bash
   npx tsx --env-file=.env.production.local scripts/check-production-env.ts --ping
   # or, with variables already exported: npm run check:env -- --ping
   ```
8. **After deploying**, point the platform's readiness probe at `GET /api/health?readiness=true`. It returns `503` unless the database, AI provider and auth infrastructure (Redis reachable and `SESSION_ENCRYPTION_KEY` present) are all ready. Only statuses are reported, never URLs or credentials. `GET /api/health` without the parameter is the liveness probe and stays `200` while the process is up.
9. **Run the staging E2E suite** (`Staging E2E` workflow, or `npm run test:e2e` with `E2E_BASE_URL` and a confirmed test account).

---

## 🔒 Security & Privacy

- **Server-Side AI Proxy**: API keys are never exposed to the client bundle.
- **Row Level Security**: Database rows are protected with PostgreSQL RLS policies in `supabase/migrations/20261012000000_thinkmate_schema.sql`.
- **Ownership Verification**: Endpoints enforce user ownership to block insecure direct-object references (IDOR).
- **Data Erasure**: Built-in "Wipe All Data" action in Settings allows users to clear all sessions and insights immediately.
- **Dependency Audit**: CI runs two gates. `npm audit --omit=dev --audit-level=high` fails on any high-severity production advisory. `npm run audit:ci` (`scripts/audit-gate.ts`) audits the full tree, dev dependencies included, and fails on any high or critical advisory not listed in [`audit-allowlist.json`](audit-allowlist.json). Each allowlist entry is pinned to an exact advisory ID and package and has a `reviewBy` date; the gate fails once that date passes. The only accepted entry is `braces@3.0.3` ([GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), stack-exhaustion DoS through deeply nested brace patterns), reached via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. npm reports this one advisory as 5 high findings, one for each package in the chain. No patched `braces` release exists, and npm's suggested fix (downgrading `eslint-config-next` to 14.x) is incompatible with Next.js 16. It only runs inside ESLint on repository-controlled glob patterns, never user input, and is not in the production bundle.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

