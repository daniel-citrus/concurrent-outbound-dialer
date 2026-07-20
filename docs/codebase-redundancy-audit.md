# Codebase redundancy audit

**Date:** 2026-07-20  
**Scope:** Dialer service (`src/`), visualizer (`frontend/`), migrations, tests, docs, and ancillary trees (`my-video/`).  
**Mode:** Read-only analysis. No code was deleted, renamed, moved, or refactored as part of this audit.

---

## 1. Executive summary

This repository is a focused concurrent outbound dialer: Fastify + PostgreSQL backend, Svelte 5 visualizer, mock voice provider, and Nebula (Supabase) list import. Overall architecture is coherent and not over-abstracted. Domain boundaries between `SessionService`, `SessionOrchestrator`, `CallStatusProcessor`, `WinnerSelector`, and `CallCanceler` are intentional and should mostly stay separate.

The highest-value cleanup is **removing confirmed dead code and fixing conflicting ownership**, not inventing shared frameworks. Concrete wins:

1. **Pool lifecycle mismatch** — `closePool()` does not close the pool `buildApp` creates (`createPool` never registers the singleton).
2. **Confirmed unused modules/exports** — plugin wrapper files, no-op `eventRoutes`, unused status helpers/error factories, stale domain `CreateSessionInput`.
3. **Mirrored status/snapshot types** — frontend redefines backend enums and DTO shapes; drift already exists (`SIMULATE_STATUSES` vs `SIMULATABLE_CALL_STATUSES`, unused domain create input missing `autoContinue`).
4. **Repeated permit-release and auto-continue sequences** — same patterns in `CallCanceler`, `CallStatusProcessor`, and `RecoveryService`.
5. **Extraneous Remotion tree** — `my-video/` (including nested `my-video/my-video/`) is unrelated to the dialer and is a large accidental scaffold.

Do **not** merge the session orchestration services into one class, do **not** collapse ConcurrencyBoard + SemaphoreBoard, and do **not** introduce a shared frontend/backend package solely to DRY types unless a codegen/schema pipeline is planned.

---

## 2. Codebase areas reviewed

| Area | Paths | Notes |
| --- | --- | --- |
| App bootstrap / DI | `src/app.ts`, `src/server.ts`, `src/types/app.ts` | Manual wiring; circular deps via setters |
| Config | `src/config/env.ts`, `.env.example` | Zod schema; mock auto-sim knobs |
| Domain | `src/domain/*` | Statuses, transitions, errors, entities |
| Controllers | `src/controllers/*` | Per-session semaphore/mutex runtime |
| Services | `src/services/*` | Session, orchestrator, status, winner, cancel, recovery, Nebula, completion |
| Repositories | `src/repositories/*` | Thin SQL + mappers; claim CTE |
| Providers | `src/providers/*` | Mock voice + auto-simulator |
| Routes / plugins | `src/routes/*`, `src/plugins/*` | REST surface; plugin wrappers unused |
| Database | `src/database/*`, `migrations/*` | Pool helpers; migrations 002–004 |
| Frontend | `frontend/src/**` | Store, API client, boards, setup, simulate UI |
| Tests | `tests/unit/*`, `tests/integration/*`, `tests/helpers/*` | Unit + integration coverage for core dialer |
| Docs | `docs/ARCHITECTURE.md`, `docs/implementation-plans/*` | Some plan defaults stale vs code |
| Ancillary | `my-video/**` | Remotion scaffold; nested duplicate |
| Dependencies | root + `frontend/package.json` | Lean; no overlapping UI/framework deps |

**Out of scope for consolidation recommendations:** generated `dist/`, `node_modules/`, agent skill installs under `.agents/`.

---

## 3. Top-priority findings

| ID | Severity | Finding | Why first |
| --- | --- | --- | --- |
| F01 | **High** | Pool singleton vs `createPool` ownership conflict; shutdown may leak connections | Correctness + ops risk |
| F02 | **High** | Status/DTO mirror drift (backend ↔ frontend); simulate status lists disagree | Bug risk from inconsistent contracts |
| F03 | **Medium** | Dead plugin wrappers + no-op `eventRoutes` | Safe removal, less noise |
| F04 | **Medium** | Unused domain exports (`CreateSessionInput`, status guards, error helpers) | Dead code / false documentation |
| F05 | **Medium** | Duplicated permit-release + auto-continue blocks | Inconsistent behavior risk |
| F06 | **Medium** | `my-video/` + nested clone outside product | Large unrelated surface |
| F07 | **Medium** | Request-ID assigned twice (`genReqId` + `registerRequestContext`) | Confusing dual ownership |
| F08 | **Low–Med** | `simulateMany` / `simulateAllActive` nearly identical | Easy frontend DRY |
| F09 | **Low–Med** | Accordion panel CSS duplicated (AutoSimulate + Semaphore) | UI maintenance |
| F10 | **Low** | Stale plan doc: `autoContinue` default false vs code/migration true | Doc/code mismatch |

---

## 4. Complete findings table

Findings are categorized below. Each includes severity, category, symbols, evidence, consolidation approach, risks, effort, and confidence.

### Safe removals

#### F03 — Unused Fastify plugin wrapper modules
- **Severity:** Medium  
- **Category:** Dead code / unnecessary abstraction  
- **Paths / symbols:**  
  - `src/plugins/error-handler.ts` → `errorHandlerPlugin`  
  - `src/plugins/request-context.ts` → `requestContextPlugin`  
  - `src/plugins/service-api-key.ts` → `serviceApiKeyPlugin`  
- **Explanation:** Thin wrappers around functions already defined and used from `register.ts`.  
- **Evidence:** Grep shows zero imports of these plugins; `app.ts` calls `registerRequestContext`, `registerErrorHandler`, `registerServiceApiKey` only.  
- **Consolidation:** Delete the three wrapper files; keep `register.ts`.  
- **Risks:** None if no external package imports them (none found).  
- **Effort:** Small · **Confidence:** High  

#### F03b — No-op `eventRoutes`
- **Severity:** Low  
- **Category:** Dead code / legacy placeholder  
- **Paths / symbols:** `src/routes/events.routes.ts` → `eventRoutes`  
- **Explanation:** Explicit no-op; events live under `GET /sessions/:id/events` in `sessionRoutes`.  
- **Evidence:** Not registered in `app.ts`; only self-reference. Comment admits placeholder.  
- **Consolidation:** Delete file, or register a redirect/alias only if clients need it (none found).  
- **Risks:** None for current API consumers.  
- **Effort:** Small · **Confidence:** High  

#### F04a — Unused domain `CreateSessionInput`
- **Severity:** Medium  
- **Category:** Dead type / conflicting ownership  
- **Paths / symbols:** `src/domain/session.ts` → `CreateSessionInput`  
- **Explanation:** Backend create path uses Zod `createSessionSchema` in `SessionService`, not this type. Type is also missing `autoContinue`, so it is stale relative to the real API.  
- **Evidence:** Only definition site in `src/`; no imports. Frontend has its own `CreateSessionInput` with `autoContinue?`.  
- **Consolidation:** Remove domain type, or replace with `z.infer<typeof createSessionSchema>` exported from one place.  
- **Risks:** Low; confirm no generated clients.  
- **Effort:** Small · **Confidence:** High  

#### F04b — Unused status helpers / constants
- **Severity:** Low  
- **Category:** Dead exports  
- **Paths / symbols:**  
  - `ACTIVE_SESSION_STATUSES`  
  - `isSessionStatus`, `isContactStatus`  
  - Frontend `SIMULATE_STATUSES`  
  - Frontend `VisualizerState`  
- **Explanation:** Defined but never referenced outside their defining files.  
- **Evidence:** Repo-wide grep (excluding docs) hits definition only.  
- **Consolidation:** Remove, or wire UI to them if intended as shared helpers. Prefer delete until needed.  
- **Risks:** Low.  
- **Effort:** Small · **Confidence:** High  

#### F04c — Unused error factories
- **Severity:** Low  
- **Category:** Dead exports  
- **Paths / symbols:** `invalidCallTransition`, `concurrencyConflict` in `src/domain/errors.ts`  
- **Explanation:** Never thrown or imported. Call transitions log-and-ignore via `evaluateCallAttemptTransition` instead.  
- **Evidence:** Grep hits definitions only.  
- **Consolidation:** Remove until a caller needs them.  
- **Risks:** Low.  
- **Effort:** Small · **Confidence:** High  

#### F01b — Unused pool singleton accessors
- **Severity:** Medium (paired with F01)  
- **Category:** Dead code / conflicting ownership  
- **Paths / symbols:** `getPool`, `setPool` in `src/database/pool.ts`  
- **Explanation:** Nothing calls `getPool`/`setPool`. App and tests use `createPool` directly.  
- **Evidence:** Grep shows definitions only; `server.ts` still calls `closePool()` which only ends the unused singleton.  
- **Consolidation:** See F01 — unify lifecycle, then delete unused API.  
- **Risks:** Medium if something outside repo used them (none found).  
- **Effort:** Small–medium · **Confidence:** High  

#### F06 — Extraneous Remotion project tree
- **Severity:** Medium  
- **Category:** Dead / unrelated tree  
- **Paths:** `my-video/` and nested identical `my-video/my-video/`  
- **Explanation:** Full Remotion scaffold with its own `node_modules`, unrelated to dialer runtime. Nested copy appears accidental (`create` run inside existing project).  
- **Evidence:** No references from root `package.json`, `src/`, or `frontend/`. Nested package.json/src match outer scaffold.  
- **Consolidation:** Move outside the dialer repo or delete nested clone; add to `.gitignore` if kept locally.  
- **Risks:** Lose local video experiments if deleted without backup. Confirm with owner.  
- **Effort:** Small (delete) / Medium (relocate) · **Confidence:** High that it is not wired into the dialer  

---

### Safe consolidations

#### F08 — Duplicate simulate bulk helpers in store
- **Severity:** Low–Medium  
- **Category:** Duplicated logic  
- **Paths / symbols:** `createVisualizerStore().simulateMany`, `.simulateAllActive` in `frontend/src/lib/store.svelte.ts`  
- **Explanation:** Both build unique IDs, `Promise.allSettled`, and format the same partial-failure error.  
- **Evidence:** Near-identical blocks (~lines 274–322).  
- **Consolidation:** Extract `simulateIds(ids, status)` used by both.  
- **Risks:** Low.  
- **Effort:** Small · **Confidence:** High  

#### F09 — Duplicated developer accordion panel styles
- **Severity:** Low  
- **Category:** Similar UI / repeated CSS  
- **Paths:** `AutoSimulatePanel.svelte`, `SemaphoreBoard.svelte` (`.panel-summary`, `.summary-chevron`, etc.)  
- **Explanation:** Same collapsible-panel visual language copy-pasted.  
- **Evidence:** Shared class names and structure; both only shown in developer mode from `App.svelte`.  
- **Consolidation:** Shared CSS class in `app.css` or a tiny `DevDetailsPanel.svelte` wrapper for chrome only (not content).  
- **Risks:** Over-generic wrapper could hurt readability — prefer CSS extraction.  
- **Effort:** Small · **Confidence:** High  

#### F11 — Phone E.164 regex duplicated
- **Severity:** Low  
- **Category:** Duplicated validation  
- **Paths / symbols:** `e164Like` in `session-service.ts` and `nebula-prospect-lists.ts`  
- **Explanation:** Same regex; Nebula path also has `normalizePhoneToE164`. Create-session only validates, does not normalize.  
- **Evidence:** Identical `/^\+[1-9]\d{6,14}$/` literals.  
- **Consolidation:** Shared `src/domain/phone.ts` (or similar) exporting regex + normalize. Optionally normalize on create.  
- **Risks:** Changing create validation to accept non-E.164-then-normalize alters API behavior — verify with tests.  
- **Effort:** Small · **Confidence:** High  

#### F12 — Nebula user display-name logic mirrored
- **Severity:** Low  
- **Category:** Duplicate transformation  
- **Paths / symbols:**  
  - Backend `formatNebulaUserLabel` (`nebula-users.ts`)  
  - Frontend `nebulaUserDisplayName` (`frontend/src/lib/types.ts`)  
- **Explanation:** Same name fallback chain; backend also appends email for `label`. Frontend recomputes display name from fields.  
- **Evidence:** Parallel `name || fullName || first+last || email local-part || "Unknown"`.  
- **Consolidation:** Prefer API `label` / a dedicated `displayName` field; frontend uses server label only.  
- **Risks:** Low if API already sends `label`.  
- **Effort:** Small · **Confidence:** High  

#### F13 — `formatActivity` vs `formatStatus` on frontend
- **Severity:** Low  
- **Category:** Duplicate utility  
- **Paths:** `contact-display.formatActivity`, `types.formatStatus` — both `replaceAll("_", " ")`  
- **Consolidation:** One `humanizeSnakeCase` helper.  
- **Risks:** None.  
- **Effort:** Small · **Confidence:** High  

---

### Consolidations requiring behavioral verification

#### F01 — Database pool lifecycle conflict
- **Severity:** High  
- **Category:** Conflicting ownership / dead shutdown path  
- **Paths / symbols:** `createPool`, `getPool`, `setPool`, `closePool`; callers in `app.ts`, `server.ts`  
- **Explanation:** `buildApp` uses `createPool` without setting the module singleton. `server.ts` shutdown calls `closePool()`, which only ends the singleton (usually unset) — the live pool may never be closed.  
- **Evidence:**  
  - `app.ts`: `options.db ?? createPool(...)`  
  - `closePool` only acts on private `pool`  
  - `setPool` never called anywhere  
- **Consolidation options:**  
  1. `buildApp`/`server` register pool via `setPool`, or  
  2. Return `db` from app and close `app.services.db` on shutdown; delete singleton API.  
- **Risks:** Double-close, test pool sharing, migrate CLI pool. Must run integration tests + manual SIGTERM check.  
- **Effort:** Medium · **Confidence:** High  

#### F05a — Idempotent permit release duplicated
- **Severity:** Medium  
- **Category:** Repeated business logic  
- **Paths / symbols:**  
  - `CallCanceler.releasePermitIdempotent`  
  - `CallStatusProcessor.handleTerminal` (mark + release both branches)  
- **Explanation:** Same pattern: `markPermitReleased` then local `controller.releasePermit` regardless of mark result.  
- **Evidence:** Parallel if/else that always calls `releasePermit`.  
- **Consolidation:** Single helper e.g. `releasePermitDurable(db, controller, callAttemptId)` used by canceler, status processor, and possibly recovery.  
- **Risks:** Permit accounting bugs under races; must run unit + integration dialer tests (winner, cancel, pause, stop).  
- **Effort:** Medium · **Confidence:** High  

#### F05b — Auto-continue after winner terminal duplicated
- **Severity:** Medium  
- **Category:** Repeated business logic / dual ownership  
- **Paths / symbols:**  
  - `CallStatusProcessor.handleTerminal` (winner path)  
  - `RecoveryService.recover` (`winner_selected` branch)  
- **Explanation:** Both: `tryCompleteSessionIfExhausted` → if not complete and `autoContinue` → `sessionService.continueDialing(..., "auto")` with warn-on-error.  
- **Evidence:** Near-identical control flow and logging.  
- **Consolidation:** Extract `maybeAutoContinue(sessionId)` on `SessionService` or a small helper used by both.  
- **Risks:** Recovery vs live-status timing differences; need integration tests for autoContinue true/false and restart mid-winner.  
- **Effort:** Medium · **Confidence:** High  

#### F02 — Frontend/backend status and DTO mirrors
- **Severity:** High (maintenance / drift)  
- **Category:** Duplicate types / inconsistent naming  
- **Paths / symbols:**  
  - Backend: `src/domain/statuses.ts`, snapshot types in `session-service.ts`, `MockAutoSimulateState` in `mock.routes.ts`  
  - Frontend: `frontend/src/lib/types.ts` (statuses, snapshots, Nebula DTOs, mock config)  
- **Explanation:** Hand-maintained duplicates. Known drift: frontend `SIMULATE_STATUSES` omits `"unknown"` while backend `SIMULATABLE_CALL_STATUSES` includes it. Session/runtime snapshot types redefined with weaker `string` statuses on backend service types vs frontend unions.  
- **Evidence:** Parallel unions; unused frontend `SIMULATE_STATUSES`; backend service snapshot uses `status: string`.  
- **Consolidation approaches (pick one):**  
  1. **Lightweight:** Shared JSON Schema / Zod schemas in a small `packages/contract` or `shared/` imported by both (needs build plumbing).  
  2. **Pragmatic:** Single source on backend; generate OpenAPI or a checked `frontend/src/lib/generated-types.ts` in CI.  
  3. **Minimal:** Delete unused frontend constants; add a unit test asserting frontend status arrays match backend exports via a thin shared `.ts` file compiled for both.  
- **Risks:** Premature monorepo packaging is high cost for this repo size. Prefer (3) then (2).  
- **Effort:** Medium–Large · **Confidence:** High that drift exists; Medium on best packaging approach  

#### F07 — Dual request-ID assignment
- **Severity:** Medium  
- **Category:** Conflicting ownership  
- **Paths / symbols:** `buildApp` `genReqId`; `registerRequestContext` onRequest hook  
- **Explanation:** Both read `x-request-id` and generate a UUID if missing. Fastify’s req id and `request.requestId` can diverge if one path regenerates.  
- **Evidence:** Parallel header parsing in `app.ts` and `plugins/register.ts`.  
- **Consolidation:** One authority — e.g. only `genReqId`, and request-context copies `request.id` into `request.requestId` / child logger.  
- **Risks:** Log correlation changes; verify error payloads still include stable id.  
- **Effort:** Small · **Confidence:** High  

#### F14 — `acquirePermitForAttempt` vs `acquirePermitForRecovery`
- **Severity:** Low  
- **Category:** Near-duplicate methods  
- **Paths:** `SessionController`  
- **Explanation:** Both acquire semaphore and write `activeCalls`; recovery always overwrites map entry and sets `providerCallId`.  
- **Consolidation:** One method with optional `{ providerCallId?, replace?: boolean }`.  
- **Risks:** Subtle recovery vs live dial differences; covered by session-controller + session-manager tests.  
- **Effort:** Small · **Confidence:** Medium  

#### F15 — `CallCanceler.cancelOrDisconnect` cancel vs disconnect branches
- **Severity:** Low  
- **Category:** Similar control flow  
- **Paths:** `call-canceler.ts`  
- **Explanation:** Two branches share event append, status update, contact update, permit release.  
- **Consolidation:** Parameterize provider action + expectedStatuses + event type.  
- **Risks:** Easy to obscure semantics (cancel vs disconnect). Only consolidate if a third action appears.  
- **Effort:** Medium · **Confidence:** Medium that consolidation helps  

#### F16 — Circular DI via setters on `CallStatusProcessor`
- **Severity:** Medium  
- **Category:** Premature / awkward abstraction / ownership  
- **Paths:** `setOrchestrator`, `setSessionService` in `call-status-processor.ts`; wired in `app.ts`  
- **Explanation:** Breaks construct-time cycle among orchestrator ↔ processor ↔ session service. Works, but hides required collaborators (optional until set).  
- **Consolidation:** Event bus / callback injection at construction, or a thin `SessionLifecycleHooks` interface created after all services.  
- **Risks:** Easy to introduce null-dereference regressions; needs full integration suite.  
- **Effort:** Medium–Large · **Confidence:** High that pattern is awkward; Medium that a rewrite is worth it now  

#### F17 — Stopping session logic in service vs recovery
- **Severity:** Medium  
- **Category:** Repeated transition logic  
- **Paths:** `SessionService.stop`, `RecoveryService` stopping branch  
- **Explanation:** Both cancel actives, wait for zero actives, mark stopped, append event, update controller, `removeIfInactive`.  
- **Consolidation:** `SessionService.finalizeStop(sessionId)` used by HTTP stop and recovery.  
- **Risks:** Recovery-specific event payload (`via: "recovery"`) must remain distinguishable.  
- **Effort:** Medium · **Confidence:** Medium  

---

### Possible redundancies requiring further investigation

#### F18 — Repository constructed per method call
- **Severity:** Low  
- **Category:** Repeated pattern (not necessarily harmful)  
- **Paths:** Most services: `new SessionRepository(this.db)` inside each method (~50+ instantiations)  
- **Explanation:** Stateless wrappers; allocation cost is trivial. Looks noisy.  
- **Investigation:** Whether constructor-held repos improve readability without complicating transactions (`withTransaction` passes `client`).  
- **Recommendation:** Optional cleanup; not a priority. Avoid a DI container.  
- **Effort:** Medium · **Confidence:** Low that change pays off  

#### F19 — Serializers living inside `SessionService` module
- **Severity:** Low  
- **Category:** Mixed responsibilities  
- **Paths:** `serializeSession|Contact|CallAttempt|Event` exported from `session-service.ts`, used by routes  
- **Explanation:** Not unused, but couple HTTP DTO mapping to the domain service file (already 600+ lines).  
- **Investigation:** Move to `src/http/serializers.ts` for clarity — not redundancy removal.  
- **Effort:** Small · **Confidence:** High as organization, Low as “redundancy”  

#### F20 — Frontend transition guards mirror backend `can*` helpers
- **Severity:** Low  
- **Category:** Intentional-looking duplication  
- **Paths:** `SessionBar.svelte` hardcodes start/pause/resume/stop eligibility; backend `canStartSession` etc.  
- **Explanation:** UI disables buttons; server remains authority.  
- **Investigation:** Export a tiny shared predicate module vs keep UI freer for UX (e.g. Start from winner also checks queue counts from snapshot).  
- **Recommendation:** Keep separate unless predicates drift causes user-visible bugs.  
- **Effort:** Medium · **Confidence:** Medium  

#### F21 — `ConcurrencyBoard` vs `ContactList` overlapping contact columns
- **Severity:** Low  
- **Category:** Similar UI  
- **Paths:** Both show name/company/title + call status tone  
- **Explanation:** Different jobs: live concurrency slots vs full durable queue. Shared cell rendering possible; full merge would hurt UX.  
- **Recommendation:** Optional shared `ContactIdentityCell`; do not merge boards.  
- **Effort:** Small · **Confidence:** Medium  

#### F22 — Claim CTE re-fetches rows after insert
- **Severity:** Low  
- **Category:** Inefficiency (not duplicate module)  
- **Paths:** `claimContactsAndReserveAttempts` — CTE returns ids then `SELECT *` per claim  
- **Explanation:** Extra queries; could `RETURNING` full rows from CTE.  
- **Recommendation:** Performance pass, not redundancy pass.  
- **Effort:** Medium · **Confidence:** High  

#### F23 — Stale implementation-plan docs vs shipped defaults
- **Severity:** Low  
- **Category:** Doc drift  
- **Paths:** `docs/implementation-plans/multi-round-session-continue.md` still says `autoContinue` default **false**; code + migration `004` default **true**.  
- **Recommendation:** Update plan or mark superseded; avoid “fixing” code to match old plan.  
- **Effort:** Small · **Confidence:** High  

#### F24 — `VOICE_PROVIDER` enum only `"mock"` but fallback always constructs mock
- **Severity:** Low  
- **Category:** Premature abstraction  
- **Paths:** `env.ts`, `app.ts` voice wiring  
- **Explanation:** Interface `VoiceProvider` is good for future Twilio; current branching + `mockVoiceProvider` decoration is denser than needed for a single implementation.  
- **Recommendation:** Leave interface; simplify `buildApp` wiring when touching mock auto-sim again.  
- **Effort:** Small · **Confidence:** Medium  

---

### Intentional duplication that should remain separate

| Item | Why keep separate |
| --- | --- |
| `SessionService` vs `SessionOrchestrator` vs `CallStatusProcessor` | Different lifecycles: HTTP transitions vs admit/dial vs webhook/status. Merging would recreate a god-object. |
| `WinnerSelector` vs `CallCanceler` | Atomic winner claim vs provider cancel/disconnect side effects. |
| `SessionController` (memory) vs repositories (Postgres) | Core architecture: durable truth vs per-process admission. |
| `ConcurrencyBoard` vs `SemaphoreBoard` | Board = durable/active call slots for operators; Semaphore = in-memory permit debug. Different data sources (`calls` vs `runtime`). |
| Frontend types vs domain types (until codegen) | Browser bundle should not import server DB/domain modules; some duplication is normal. |
| Nebula users vs prospect-lists modules | Different REST resources and mapping; shared only via `nebula-client`. |
| UI eligibility vs server `can*` guards | UX vs authorization/consistency; server must remain source of truth. |
| Mock auto-sim header toggle vs `AutoSimulatePanel` | Toggle = enable; panel = tune rates. Complementary, not duplicate. |
| `tryCompleteSessionIfExhausted` as shared function | Already correctly extracted; callers should stay plural. |

---

## 5. Dead-code candidates

| Candidate | Confidence | Notes |
| --- | --- | --- |
| `src/plugins/{error-handler,request-context,service-api-key}.ts` | High | Unused wrappers |
| `src/routes/events.routes.ts` | High | No-op, unregistered |
| `domain/session.CreateSessionInput` | High | Unused; stale vs Zod |
| `ACTIVE_SESSION_STATUSES`, `isSessionStatus`, `isContactStatus` | High | Unused |
| `invalidCallTransition`, `concurrencyConflict` | High | Unused |
| Frontend `SIMULATE_STATUSES` | High | Unused; also drifts |
| Frontend `VisualizerState` | High | Unused type |
| `getPool` / `setPool` | High | Unused; related to broken close |
| Nested `my-video/my-video/**` | High | Accidental scaffold clone |
| Outer `my-video/**` (product relevance) | Medium–High | Unrelated; confirm before delete |
| Plugin files’ FastifyPluginAsync variants | High | Prefer `register.ts` |

**Caution:** Do not treat “no local import” as proof for:

- Migrations (applied by filename, not imports)  
- `VoiceProvider` (future / DI injection in tests)  
- Route plugins registered only in `app.ts`  
- Env vars consumed only at runtime  
- Dynamic status strings from providers  

---

## 6. Duplicate dependency analysis

| Dependency | Role | Duplicate / overlap? |
| --- | --- | --- |
| `fastify` + `pino` | HTTP + logging | Not redundant — app constructs `pino` directly and types `Logger` |
| `pino-pretty` | Dev transport | Dev-only; appropriate |
| `zod` | Env + request validation | Single validation library — good |
| `pg` | Database | Sole DB client — good |
| `async-mutex` | Semaphore/Mutex | Sole concurrency primitive — good; matches architecture |
| `dotenv` | Env load | Appropriate |
| Frontend: `svelte` + `vite` only | Visualizer | Lean; no duplicate UI kits |
| Remotion stack under `my-video/` | Video | **Overlaps nothing in dialer**; entire second dependency tree |

No case found where two npm packages implement the same dialer capability (e.g. two HTTP frameworks or two ORMs).

---

## 7. Recommended consolidation sequence

1. **Fix pool shutdown (F01)** — correctness before cleanup.  
2. **Delete confirmed dead modules/exports (F03, F04, F03b)** — reduce noise.  
3. **Align simulate/status constants (F02 minimal)** — prevent silent contract drift.  
4. **Extract permit-release + auto-continue helpers (F05)** — reduce behavioral forks.  
5. **Request-ID single path (F07)** — small clarity win.  
6. **Frontend store/CSS/phone/label quick DRYs (F08–F13)** — low risk.  
7. **Decide fate of `my-video/` (F06)** — repo hygiene.  
8. **Optional deeper refactors (F16, F17, serializers)** — only if actively touching those areas.  
9. **Shared contract package** — defer until a second client or OpenAPI is required.

---

## 8. Low-risk quick wins

1. Delete unused plugin wrapper files and `events.routes.ts`.  
2. Remove unused domain/frontend exports listed in §5.  
3. Extract `simulateIds` in the visualizer store.  
4. Dedupe accordion CSS into `app.css`.  
5. Dedupe `formatStatus` / `formatActivity`.  
6. Prefer Nebula `label` on the frontend instead of recomputing names.  
7. Update or archive stale `autoContinue` default in the multi-round plan doc.  
8. Add `.gitignore` entries for local Remotion output if `my-video` is kept.

---

## 9. Items requiring tests before modification

| Change | Tests to run / add |
| --- | --- |
| Pool close / singleton (F01) | Integration suite; manual SIGTERM; ensure test shared pool still works |
| Permit release helper (F05a) | `tests/unit/session-controller.test.ts`; integration winner + pause + stop |
| Auto-continue helper (F05b) | Existing autoContinue cases in `tests/integration/dialer.test.ts`; add recovery restart case if missing |
| Status list alignment (F02) | `tests/unit/statuses.test.ts`; route validation for simulate including `unknown` |
| Request-ID unification (F07) | Inject request with/without `x-request-id`; assert response header + error body id match logs |
| Stop finalize shared (F17) | Stop with active calls; recovery of `stopping` sessions |
| Phone normalize on create (F11) | Create session with `415…` vs `+1415…` if behavior changes |
| Setter DI rewrite (F16) | Full unit + integration; winner auto-continue; reconcile after terminal |

---

## 10. Areas where duplication appears intentional

- **Layered session pipeline** (service → orchestrator → provider → status processor) documented in `docs/ARCHITECTURE.md`.  
- **Postgres vs in-memory semaphore** as dual concurrency views.  
- **Mock simulate UI vs auto-simulator** — two control modes for the same status pipeline.  
- **Nebula import mapping** kept server-side; frontend only displays enriched contact details carried in store.  
- **Append-only `dial_events`** alongside mutable tables — audit trail, not duplicate state store.  
- **Per-method repository construction** — simple, transaction-friendly, no IoC framework.

---

## 11. Proposed follow-up implementation plan

Phases are independently reviewable. Do not combine unrelated phases in one PR.

### Phase 0 — Pool lifecycle fix (F01)
- **Change:** Make shutdown close the actual `app.services.db` (or register singleton consistently); remove or fix `getPool`/`setPool`.  
- **Tests before merge:** `npm test`; confirm `closePool`/shutdown path with a short script or log assertion.  
- **PR size:** Small.

### Phase 1 — Dead code deletion
- **Change:** Remove unused plugin wrappers, `eventRoutes`, unused domain/frontend exports and error helpers.  
- **Tests:** `npm run typecheck` + `npm test`.  
- **PR size:** Small.

### Phase 2 — Contract drift hardening (minimal F02)
- **Change:** Delete unused `SIMULATE_STATUSES` or make it match backend (include `unknown`); tighten backend snapshot types to `SessionStatus` / `CallAttemptStatus`; optionally add a test that frontend active-call list equals backend `ACTIVE_CALL_ATTEMPT_STATUSES` via a shared constants file under `src/domain` imported only in tests first.  
- **Tests:** `tests/unit/statuses.test.ts`; simulate route validation.  
- **PR size:** Small–medium.

### Phase 3 — Permit release + auto-continue helpers (F05)
- **Change:** Extract shared helpers; call from canceler, status processor, recovery.  
- **Tests:** Unit controller tests; integration dialer (winner, autoContinue true/false, pause/stop).  
- **PR size:** Medium.

### Phase 4 — Request-ID single path (F07)
- **Change:** One generator; context plugin reuses Fastify id.  
- **Tests:** Inject with custom header; error handler payload.  
- **PR size:** Small.

### Phase 5 — Frontend DRY (F08–F13, F09)
- **Change:** Store simulate helper; CSS extract; phone/label/status string helpers.  
- **Tests:** Frontend `npm run check --prefix frontend`; manual developer-mode simulate.  
- **PR size:** Small.

### Phase 6 — Ancillary tree hygiene (F06)
- **Change:** Owner decision: relocate or delete `my-video/` (especially nested clone); update `.gitignore` if retained.  
- **Tests:** N/A for dialer.  
- **PR size:** Small (delete) / informational.

### Phase 7 — Optional structural cleanups (only when touching those files)
- **Candidates:** `finalizeStop` (F17); serializers file move (F19); simplify `buildApp` mock wiring (F24); reconsider setter DI (F16).  
- **Tests:** Full suite + targeted new cases per change.  
- **PR size:** Medium each; do not bundle.

### Phase 8 — Shared API contract (defer)
- **Change:** OpenAPI or `shared/` Zod schemas generating frontend types.  
- **Tests:** Contract tests in CI.  
- **PR size:** Large — only when a second consumer appears.

---

## Harmful consolidations (do not do)

| Temptation | Why harmful |
| --- | --- |
| Merge SessionService + Orchestrator + StatusProcessor | Recreates a god-object; harder to test and reason about races |
| Merge ConcurrencyBoard + SemaphoreBoard | Different data sources and user jobs; “generic board” would obscure meaning |
| Shared UI kit / card system for three tables | Over-generic abstraction for a small app |
| Full IoC/DI container for repositories | Complexity without reuse benefit |
| Force frontend to import `src/domain` via path hacks | Couples browser build to server modules and Node types |
| Merge WinnerSelector into CallCanceler | Mixes consensus (DB winner) with provider I/O |
| Collapse Nebula modules into one “NebulaService” class | Hides pagination/mapping differences; little reuse beyond `nebulaFetch` |

---

## Five highest-value changes (address first)

1. **Fix database pool shutdown ownership (F01)**  
   Shutdown currently calls `closePool()` on an unused singleton while the live pool from `createPool` may never close. This is an operational correctness issue, not stylistic DRY.

2. **Eliminate status/DTO mirror drift (F02, minimal path)**  
   Hand-copied status lists already disagree (`unknown` in simulate). Aligning constants (and eventually generating types) prevents UI/API bugs that unit tests of only one side will miss.

3. **Extract shared permit-release and auto-continue sequences (F05)**  
   The same multi-step policies exist in multiple services. Divergence here causes subtle concurrency and multi-round dialing bugs that are expensive to debug.

4. **Remove confirmed dead code (F03/F04/events/plugins)**  
   Unused wrappers and placeholders inflate navigation cost and falsely suggest alternate entry points. Safe, high-confidence deletions.

5. **Quarantine or remove `my-video/` (F06)**  
   A nested Remotion scaffold (with its own `node_modules`) is the largest unrelated surface area in the workspace and distracts from the dialer product. Resolving it improves repo clarity immediately.

These five maximize correctness, consistency, and signal-to-noise before any larger architectural redesign.
