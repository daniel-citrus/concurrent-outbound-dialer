# Rewrite standalone dialer DB access: pg pool → Supabase RPC

**Repo:** `concurrent-outbound-dialer`  
**Branch:** `client-side-orchestrator` (or current dialer working branch)  
**Paste this entire document into Cursor Agent while that repo is open.**

---

## Goal

Replace the dialer service’s direct Postgres access (`pg` Pool + `DATABASE_URL` + repository SQL / `withTransaction`) with **Supabase RPC + `@supabase/supabase-js` (service role)**.

After this change:

- The Fastify dialer service should run against **Supabase Postgres** using the same credential style Nebula uses (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), not a raw connection string for app logic.
- Claim / winner / status / session lifecycle semantics stay the same.
- HTTP API contracts stay the same (so Nebula BFF / visualizer / client orchestrator keep working).
- `DATABASE_URL` / raw `pg` should no longer be required for normal operation.

## Non-goals

- Do not redesign session/claim/winner product behavior
- Do not remove Fastify routes or the client orchestrator
- Do not implement Nebula UI integration here (that lives in Nebula’s `concurrency-integration` branch)
- Do not drop dialer tables

## Context (current code)

| Area | Path |
|------|------|
| Env | `src/config/env.ts` — currently requires `DATABASE_URL`; already has optional `NEBULA_SUPABASE_URL` / `NEBULA_SUPABASE_SERVICE_ROLE_KEY` |
| Pool | `src/database/pool.ts` — `createPool`, `withTransaction` |
| Boot | `src/app.ts` — creates `pg` pool from `env.DATABASE_URL` |
| Schema | `migrations/001_dialer_schema.sql` |
| Repos | `src/repositories/*.ts` — raw SQL via `DbPool` / `DbClient` |
| Services | `src/services/session-service.ts`, `call-launch.ts`, `call-status-processor.ts`, `winner-selector.ts`, `call-canceler.ts`, `permit-release.ts`, `session-completion.ts`, `recovery-service.ts` |
| Routes | `src/routes/sessions.routes.ts`, `calls.routes.ts`, … |
| Client orchestrator | `frontend/src/lib/orchestrator/*` — talks HTTP to this service; should stay unchanged |
| Tests | `tests/unit`, `tests/integration` |

Critical atomic paths today (must remain atomic in Postgres):

- Contact claim with `FOR UPDATE SKIP LOCKED`
- Winner selection + `winning_call_attempt_id`
- Session create (session + contacts batch)
- Status transitions that trigger winner / completion / continue

## Requirements

### 1. Env / credentials

- Prefer:
  - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  - or reuse/rename existing `NEBULA_SUPABASE_URL` + `NEBULA_SUPABASE_SERVICE_ROLE_KEY` into a single clear pair (document the chosen names)
- Stop requiring `DATABASE_URL` for app boot once RPC path works
- Optional: keep `DATABASE_URL` only for local migration tooling (`db:migrate`), not for runtime repositories
- Update `.env.example` / README accordingly

### 2. SQL RPCs (new migration)

Add an additive migration (e.g. `migrations/002_dialer_supabase_rpcs.sql`) that creates Postgres functions covering every transactional / multi-statement operation currently done in TypeScript + `pg`.

Minimum RPC set:

| RPC | Purpose |
|-----|---------|
| `dialer_create_session(...)` | Insert session + contacts atomically; return session + contacts |
| `dialer_claim_contacts(session_id, limit)` | `SKIP LOCKED` claim + insert `call_attempts` (`creating`) |
| `dialer_mark_call_created(attempt_id, provider_call_id)` | Attempt → initiated/queued as today |
| `dialer_mark_call_creation_failed(attempt_id, error_code, error_message)` | Failed create path |
| `dialer_report_status(attempt_id, status)` | Validated transition; winner/completion side effects as today |
| `dialer_select_winner(...)` or fold into report-status | Atomic winner + session pointer |
| `dialer_reconcile_hint(session_id)` | persisted active count, queued/claimed counts, concurrency limit, status |
| Session lifecycle | `dialer_start_session`, `pause`, `resume`, `stop`, `set_auto_continue` |
| Reads (RPC or supabase `.from`) | get session, list contacts/calls/events, status snapshot |

Rules:

- Preserve existing table CHECKs / statuses from `001_dialer_schema.sql`
- Prefer packing true critical sections into **one RPC per atomic operation**
- `SECURITY DEFINER` only if needed; if used, restrict `EXECUTE` and avoid exposing unsafe functions to `anon`
- Additive only — no `DROP TABLE`
- Grant execute to `service_role` (and whatever role the service uses)

### 3. Replace `pg` data layer in the Fastify service

- Add `@supabase/supabase-js` dependency
- Create a small Supabase admin client module (from env)
- Rewrite repositories/services to call `.rpc(...)` (and `.from(...)` for simple reads if safe)
- Remove runtime use of `createPool(env.DATABASE_URL)` from `app.ts` service wiring
- Remove or narrow `src/database/pool.ts` so production request path does not need `pg`
- Keep Zod validation at route/service boundaries
- Keep in-memory `SessionManager` / semaphore behavior unless it depended on raw SQL transactions incorrectly — client orchestrator era may already own reconcile timing; do not break it

### 4. Preserve HTTP API contracts

Fastify JSON responses must remain compatible with:

- `frontend/src/lib/api.ts`
- `frontend/src/lib/orchestrator/session-client.ts`
- Any Nebula proxy that already mirrors these routes

Especially:

- `POST /sessions`
- `POST /sessions/:id/claim`
- `POST /calls/:id/created|creation-failed|report-status`
- `GET /sessions/:id/reconcile-hint` (or equivalent status fields the client uses)
- start / pause / resume / stop / auto-continue

### 5. Auth

- Keep existing service auth (`SERVICE_API_KEY` or current scheme) for dialer HTTP
- Server uses Supabase **service role** only after request auth succeeds
- Never ship service role to the Svelte visualizer

### 6. Tests

- Update unit tests that mocked `pg` to mock supabase `.rpc` / return shapes
- Keep domain tests in `tests/unit` for statuses / capacity / cancel ops
- Adapt integration tests to either:
  - hit a Supabase project with RPCs applied, or
  - skip with a clear message when Supabase env is unset
- Ensure `npm run test:unit` passes without `DATABASE_URL` if possible

### 7. Verification checklist

- [ ] Service boots with Supabase URL + service role only (no `DATABASE_URL` required for runtime)
- [ ] Create session → start → claim → created → report-status → winner path works end-to-end
- [ ] Concurrent claims do not double-assign the same contact (`SKIP LOCKED` behavior preserved inside RPC)
- [ ] Visualizer / client orchestrator still works against local Fastify API
- [ ] `npm run test:unit` passes
- [ ] README / env docs no longer say raw `DATABASE_URL` is required for running the API

## Implementation order

1. Inventory every SQL string / transaction in `src/repositories` and services
2. Group into RPCs (claim, winner, create session, report-status first)
3. Write migration with functions + grants
4. Apply migration to the target Supabase project (document how)
5. Swap repositories to supabase-js
6. Remove pool wiring from `app.ts` / env schema runtime requirement
7. Fix tests and docs

## Acceptance

Done when the standalone dialer service’s durable concurrency engine runs on **Supabase RPC + service role**, preserves claim/winner correctness and HTTP contracts, and no longer depends on a direct Postgres connection string for normal API operation.
