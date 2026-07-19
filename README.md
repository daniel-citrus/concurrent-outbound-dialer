# Dialer Service

Standalone concurrent outbound dialer backend. One Node.js process hosts many independent dialing sessions; each session has its own controller, semaphore, reconciliation mutex, contact batch, and active-call map.

## Architecture overview

```text
Dialer Service
└── SessionManager (Map<sessionId, SessionController>)
    ├── Session A Controller — Semaphore(4), Mutex, active calls, batch
    ├── Session B Controller — Semaphore(3), Mutex, active calls, batch
    └── ...
```

PostgreSQL is the durable source of truth for sessions, ordered contacts, call attempts, and append-only events. In-memory `async-mutex` semaphores provide per-session admission control inside a single process. See [ARCHITECTURE.md](./ARCHITECTURE.md) for Mermaid diagrams.

## Session controller lifecycle

- Created lazily via `SessionManager.getOrCreate(sessionId)` from persisted session state
- Restored with one semaphore permit per persisted active/reserved attempt
- Not removed when an agent stops polling
- Removed only when the session is `stopped` / `completed` / `failed`, no active calls remain, no permits are held, and reconciliation is idle

## Session manager

Singleton `InMemorySessionManager` keyed by `sessionId`. Concurrent `getOrCreate` calls for the same id share one initialization promise so only one controller is created.

## Semaphore behavior

- Capacity equals `concurrency_limit` (1–10)
- Acquire before calling the voice provider; hold through `creating` → `in_progress`
- Release on terminal outcomes or creation failure (idempotent via `permit_released` + local flag)
- Do not queue all remaining contacts as waiters — DB retains queued contacts until capacity opens

## Mutex behavior

Each controller has a reconciliation mutex. It serializes short DB work (load state, count actives, claim contacts, reserve attempts). It is **not** held while ringing, waiting for callbacks, or calling the provider.

## PostgreSQL responsibilities

- Durable contact queue with `FOR UPDATE SKIP LOCKED` claiming
- Atomic winner selection (`UPDATE … WHERE status = 'running' AND winning_call_attempt_id IS NULL`)
- Partial unique index: one active session per `client_id`
- Partial unique index: one winner per session
- Append-only `dial_events` history

## Database schema

Four application tables (migration `002_replace_dialer_schema.sql`):

| Table | Purpose |
| --- | --- |
| `dialing_sessions` | Session lifecycle, concurrency, winner |
| `dialing_contacts` | Ordered durable batch |
| `call_attempts` | Reserved/active attempts + `permit_released` |
| `dial_events` | Lifecycle / diagnostic events |

Obsolete dialer tables (`dial_batches`, `batch_*`, etc.) are dropped when present. No unrelated non-dialer tables were found in this database.

## Provider abstraction

```ts
interface VoiceProvider {
  createCall(input): Promise<{ providerCallId; status: "queued" }>
  cancelCall(providerCallId): Promise<void>
  disconnectCall(providerCallId): Promise<void>
}
```

Business logic stays provider-neutral (`provider_call_id`, not Twilio SIDs).

## Mock provider

```bash
VOICE_PROVIDER=mock
MOCK_PROVIDER_DELAY_MS=50
MOCK_PROVIDER_FAILURE_RATE=0
```

`MockVoiceProvider` generates fake IDs, never uses the network, and records create/cancel/disconnect for tests.

## API endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness + DB check |
| `POST` | `/sessions` | Create session + contacts |
| `GET` | `/sessions/:id` | Session row |
| `GET` | `/sessions/:id/status` | Poll snapshot; `?afterVersion=` → `204` if unchanged |
| `GET` | `/sessions/:id/contacts` | Paginated contacts |
| `GET` | `/sessions/:id/calls` | Paginated attempts |
| `GET` | `/sessions/:id/events` | Paginated events |
| `POST` | `/sessions/:id/start` | Start / continue dialing |
| `POST` | `/sessions/:id/pause` | Stop launches; cancel actives |
| `POST` | `/sessions/:id/resume` | Resume from paused |
| `POST` | `/sessions/:id/stop` | Idempotent stop |
| `POST` | `/calls/:callAttemptId/simulate` | Mock status events |

Optional auth: set `SERVICE_API_KEY` and send `Authorization: Bearer <key>` (health stays open).

### Example: create and start

```bash
curl -s localhost:3000/sessions -H 'content-type: application/json' -d '{
  "clientId": "client-a",
  "agentId": "agent-a",
  "concurrencyLimit": 4,
  "contacts": [
    { "externalContactId": "contact-1", "phoneNumber": "+14155550101" },
    { "externalContactId": "contact-2", "phoneNumber": "+14155550102" }
  ]
}'

curl -s -X POST localhost:3000/sessions/<sessionId>/start
```

### Simulating call states

```bash
curl -s -X POST localhost:3000/calls/<callAttemptId>/simulate \
  -H 'content-type: application/json' \
  -d '{"status":"ringing"}'

curl -s -X POST localhost:3000/calls/<callAttemptId>/simulate \
  -H 'content-type: application/json' \
  -d '{"status":"in_progress"}'
```

Supported simulate statuses: `queued`, `initiated`, `ringing`, `in_progress`, `completed`, `busy`, `failed`, `no_answer`, `canceled`, `unknown`.

## Running locally

```bash
docker compose up -d postgres
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

API: `http://localhost:3000`

## Visual testing UI

A Svelte visualizer drives the mock provider via `/calls/:id/simulate` (no Twilio required).

```bash
# terminal 1 — API
npm run dev

# terminal 2 — UI
npm run frontend:install
npm run frontend:dev
```

UI: `http://localhost:5173` (Vite proxies `/api` → `localhost:3000`)

Workflow:

1. Create a session with contact list and concurrency limit
2. Start dialing — watch the concurrency board fill
3. Select calls with checkboxes and apply status to the selection, use **All active**, or drive each slot individually
4. `in_progress` triggers winner selection and cancels other legs

## Migrations

```bash
npm run db:migrate
```

Migrations live in `migrations/` and are tracked in `schema_migrations`.

## Tests

```bash
npm run typecheck
npm run lint
npm test
npm run test:unit
npm run test:integration
```

Integration tests use the real Postgres instance from Docker Compose and `MockVoiceProvider`.

## Recovery behavior

On startup, sessions in `running`, `winner_selected`, or `stopping` are rebuilt:

1. Recreate controllers and semaphores
2. Acquire permits for persisted active attempts
3. Reconcile `running`; retry cancel cleanup for `winner_selected` / `stopping`
4. Fail attempts stuck in `creating` beyond `CREATING_ATTEMPT_TIMEOUT_SECONDS`

With the mock provider, provider-side call verification is limited — persisted rows are trusted.

## Graceful shutdown

`SIGTERM` / `SIGINT`: stop accepting work, close HTTP, close the PG pool, exit. Persisted sessions are retained.

## Known limitations

- Single Node process only (in-memory controllers / semaphores)
- Mock voice provider only (no real Twilio network calls)
- No WebSockets, AMD, conference bridging, or multi-region lease coordination

## Future Twilio integration path

1. Implement `TwilioVoiceProvider` against the same `VoiceProvider` interface
2. Add webhook signature validation on a `/webhooks/twilio/status` route
3. Map Twilio status payloads into `CallStatusProcessor.processStatus`
4. Keep orchestrator and repositories unchanged

## Future multi-instance considerations

- Replace in-memory semaphores with DB-backed leases or a distributed limiter
- Sticky session routing or externalize controllers
- Shared recovery with fencing tokens so two instances do not launch the same contact

## Implementation status

See [IMPLEMENTATION.md](./IMPLEMENTATION.md).
