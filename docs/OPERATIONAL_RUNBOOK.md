# ThinkMate Operational Runbook & Incident Response Guide

This document defines the operational procedures, incident response matrices, disaster recovery steps, and monitoring runbooks for ThinkMate in staging and production environments.

---

## 1. System Architecture & Critical Dependencies

| Component | Provider | Role | Failure Behavior in Production |
| :--- | :--- | :--- | :--- |
| **Application Layer** | Next.js 16 (Node 22 / Edge) | API routes, SSR, UI studio | Redundant multi-instance deployment |
| **Authentication & DB** | Supabase PostgreSQL 15+ | RLS, auth sessions, state | Fail-closed on missing ownership/RLS |
| **Distributed Cache & Limiter** | Upstash Redis | Token-rotation cache, rate limiter | **Auth fails closed (503)**; non-auth configurable |
| **AI Thinking Partner** | Google Gemini 2.5 Flash | Thinking stream, cognitive steps | Returns structured user-facing error card |
| **Monitoring & Alerting** | `src/lib/monitoring.ts` | Structured JSON + Webhook alerts | Non-blocking async dispatch with deduplication |

---

## 2. Operational Incident Severity Matrix

| Severity | Definition | Target MTTA | Target MTTR | Examples |
| :--- | :--- | :--- | :--- | :--- |
| **P1 — Critical** | Complete service outage or security breach | < 15 min | < 1 hour | Distributed Redis outage locking auth; Database unreachable; Data loss risk |
| **P2 — High** | Core functionality degraded for subset of users | < 30 min | < 4 hours | Gemini API quota exhausted; High rate of auth failures; Health readiness returning 503 |
| **P3 — Warning** | Non-critical bug, latency degradation, configuration warning | < 2 hours | < 24 hours | Non-auth route rate-limit degradation; In-memory fallback in staging |

---

## 3. Incident Response Runbooks

### Runbook 1: Redis Outage / Token Cache Degradation (`REDIS_OUTAGE`)

#### Symptoms:
- Health readiness endpoint `/api/health?readiness=true` returns `503 Service Unavailable`.
- Users trying to log in, register, or refresh tokens receive `503 Service Unavailable` with error:
  `Authentication rate limiter temporarily unavailable`.
- Structured log event: `[OPERATOR ALERT] [CRITICAL] REDIS_OUTAGE`.

#### Immediate Actions:
1. **Check Upstash Status**:
   Visit [Upstash Status](https://status.upstash.com/) or the Upstash Console to confirm database operational state.
2. **Verify Connectivity**:
   Run the CLI ping check against your active credentials:
   ```bash
   npx tsx scripts/check-production-env.ts --ping
   ```
3. **Emergency Availability Policy (Non-Auth Routes)**:
   * By design, **authentication endpoints unconditionally fail closed** in production to prevent credential stuffing and brute-force bypasses.
   * If non-auth routes (AI streaming, session browsing) are blocked and you need emergency temporary availability while Upstash recovers:
     Set environment variable in your hosting platform (Vercel/Cloud Run):
     ```env
     RATE_LIMIT_FAIL_CLOSED=false
     ```
     This instructs non-auth routes to temporarily fall back to per-instance memory rate limits until Redis recovers.
4. **Post-Recovery**:
   Ensure `RATE_LIMIT_FAIL_CLOSED` is restored to `true` (or unset, which defaults to fail-closed in production).

---

### Runbook 2: Supabase Database Outage & Point-In-Time Recovery (PITR)

#### Symptoms:
- `/api/health?readiness=true` reports `dependencies.database.status: "unavailable"`.
- Requests to `/api/sessions` or `/api/workflow/transition` throw database connection errors.

#### Immediate Actions:
1. Check [Supabase Status](https://status.supabase.com/) and your project dashboard.
2. Confirm database connectivity using the staging/production verification script:
   ```bash
   npx tsx scripts/verify-supabase-staging.ts
   ```

#### Point-in-Time Restore (PITR) Procedure:
1. In the Supabase Project Dashboard, navigate to **Project Settings** -> **Database** -> **Backups**.
2. Select **Point in Time Restore (PITR)**.
3. Choose the restoration timestamp immediately preceding the incident (e.g. before an accidental data drop or migration failure).
4. Initiate restoration to a new cloned instance or restore in-place.
5. Update `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in production environment settings.
6. Verify database schema, functions, and RLS policies using:
   ```bash
   npm run test
   ```

---

### Runbook 3: Repeated Authentication Failures (`REPEATED_AUTH_FAILURES`)

#### Symptoms:
- Structured alert: `[OPERATOR ALERT] [HIGH] REPEATED_AUTH_FAILURES`.
- More than 5 consecutive authentication failures from a single IP within 60 seconds.

#### Immediate Actions:
1. Identify the offending IP address from the alert payload (`details.ip`).
2. Inspect request patterns in edge logs (Vercel Log Drains / Cloudflare Analytics).
3. If attack traffic is confirmed:
   - Add the IP to Cloudflare / WAF IP Access Rules with action **Block**.
   - If spoofing `X-Forwarded-For`, ensure `TRUSTED_PROXY_PROVIDER` and `TRUSTED_PROXY_DEPTH` are configured in production environment variables.

---

### Runbook 4: AI Provider Quota Exhaustion (`AI_PROVIDER_FAILURE`)

#### Symptoms:
- Structured alert: `[OPERATOR ALERT] [HIGH] AI_PROVIDER_FAILURE`.
- Co-Thinker returns error card: `AI thinking provider temporarily unavailable. Please retry in a few moments.`

#### Immediate Actions:
1. Visit the [Google AI Studio Console](https://aistudio.google.com/) to inspect active API quotas for `gemini-2.5-flash`.
2. Check for billing cap limits or project quota exhaustion.
3. If primary key quota is exhausted:
   - Provide an updated key via `GEMINI_API_KEY` or `GOOGLE_API_KEY` in environment variables.
   - The application automatically picks up the updated key on restart.

---

### Runbook 5: Token-Rotation Encryption Key Rotation

The `SESSION_ENCRYPTION_KEY` encrypts rotated session credentials in the distributed Redis cache using AES-256-GCM.

#### Rotation Procedure:
1. Generate a cryptographically secure 32+ byte key:
   ```bash
   openssl rand -base64 48
   ```
2. In production environment settings, update `SESSION_ENCRYPTION_KEY`.
3. Note: The distributed cache grace window is 60 seconds. During key rotation, any refresh attempts initiated in the exact 60-second transition window will gracefully authenticate via Supabase Auth without locking out users.

---

## 4. Pre-Launch Verification Checklist

Before opening the application to public production traffic:

- [ ] **Production Configuration Checked**:
  ```bash
  npx tsx scripts/check-production-env.ts --ping
  ```
  Must exit with code 0 and report 0 errors.
- [ ] **GitHub Main Branch Protected**:
  GitHub ruleset active (`ruleset id: 25276834`), requiring PRs, preventing force pushes, and requiring status checks `ci/pipeline` and `Lint, Typecheck, Test & Build`.
- [ ] **Database Verification Passed**:
  Staging Database Verification workflow (`staging-verification.yml`) succeeded on latest release commit.
- [ ] **Health Readiness Validated**:
  `GET /api/health?readiness=true` returns HTTP 200 with all 3 dependencies `ready`.
- [ ] **Operational Webhooks Configured**:
  `ALERT_WEBHOOK_URL` set in production environment variables to route critical alerts to team incident channels.
