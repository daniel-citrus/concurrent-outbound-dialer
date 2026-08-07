<a id="readme-top"></a>

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]



<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h3 align="center">Concurrent Outbound Dialer</h3>

  <p align="center">
    Standalone concurrent outbound dialer — thin Fastify HTTP API + **Supabase RPC** system of record, with a Svelte client orchestrator for mock-driven testing.
    <br />
    <a href="https://github.com/daniel-citrus/concurrent-outbound-dialer"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/daniel-citrus/concurrent-outbound-dialer/blob/main/docs/ARCHITECTURE.md">Architecture</a>
    &middot;
    <a href="https://github.com/daniel-citrus/concurrent-outbound-dialer/issues/new?labels=bug">Report Bug</a>
    &middot;
    <a href="https://github.com/daniel-citrus/concurrent-outbound-dialer/issues/new?labels=enhancement">Request Feature</a>
  </p>
</div>



<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#architecture-overview">Architecture Overview</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#api-endpoints">API Endpoints</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>



<!-- ABOUT THE PROJECT -->
## About The Project

Thin Fastify HTTP API; **Supabase Postgres via service-role RPC / PostgREST** is the system of record. The **browser client** owns reconciliation, admission control, and dial placement. Atomic claim, winner selection, and status validation stay on the server (as RPCs).

PostgreSQL is the durable source of truth for sessions, ordered contacts, call attempts, and append-only events. The Svelte visualizer runs a client orchestrator with a per-session semaphore and reconciliation mutex for local mock testing.

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for Mermaid diagrams.

### Architecture Overview

```text
Browser (Visualizer)
└── ClientSessionOrchestrator
    └── ClientSessionController — Semaphore(N), Mutex, active calls
         ├── claim / created / report-status → Thin Fastify API → Supabase RPC
         └── CallPlacer (mock today; Twilio Device later)

Fastify (HTTP) + Supabase RPCs (durable concurrency)
└── claim, lifecycle, status, winner, cancel
```

**Client orchestrator**

- Runs in the visualizer tab (one tab ≈ one session worker)
- `scheduleReconcile` after start / resume / continue and when `report-status` returns `triggeredReconcile`
- Hydrates from active attempts on reload when the session is still `running`

**Semaphore (client)**

- Capacity equals `concurrency_limit` (1–15)
- Acquire before placing a call; hold through `creating` → `in_progress`
- Release on terminal outcomes or creation failure
- Do not queue all remaining contacts as waiters — DB retains queued contacts until capacity opens

**Mutex (client)**

Serializes short claim work (load state, capacity math, `POST /claim`). It is **not** held while ringing or placing a call.

**PostgreSQL**

- Durable contact queue with `FOR UPDATE SKIP LOCKED` claiming
- Atomic winner selection (`UPDATE … WHERE status = 'running' AND winning_call_attempt_id IS NULL`)
- Partial unique index: one active session per `client_id`
- Append-only `dial_events` history

| Table | Purpose |
| --- | --- |
| `dialing_sessions` | Session lifecycle, concurrency, winner |
| `dialing_contacts` | Ordered durable batch |
| `call_attempts` | Reserved/active attempts + `permit_released` |
| `dial_events` | Lifecycle / diagnostic events |

**Call placement**

Injectable `CallPlacer` on the client (mock provider IDs in the visualizer). Server `VoiceProvider` remains for cancel/disconnect and the integration-test harness.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Built With

* [![TypeScript][TypeScript]][TypeScript-url]
* [![Node.js][Node.js]][Node-url]
* [![Fastify][Fastify]][Fastify-url]
* [![PostgreSQL][PostgreSQL]][PostgreSQL-url]
* [![Svelte][Svelte.dev]][Svelte-url]
* [![Vite][Vite]][Vite-url]
* [![Tailwind CSS][TailwindCSS]][Tailwind-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* Node.js 22+
* A Supabase project with dialer migrations applied (or local Supabase)
* npm

### Installation

1. Clone the repo
   ```sh
   git clone git@github.com:daniel-citrus/concurrent-outbound-dialer.git
   cd concurrent-outbound-dialer
   ```
2. Configure env
   ```sh
   cp .env.example .env
   # Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
   # (NEBULA_SUPABASE_* is accepted as a fallback alias)
   ```
3. Apply SQL migrations to that Supabase project  
   - Prefer: Dashboard → SQL → run `migrations/001_dialer_schema.sql` then `migrations/002_dialer_supabase_rpcs.sql`  
   - Or with a direct DB URL (migrate tooling only):
     ```sh
     DATABASE_URL=postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres npm run db:migrate
     ```
4. Install and start the API
   ```sh
   npm install
   npm run dev
   ```
   API: `http://localhost:3000`

5. (Optional) Start the visualizer
   ```sh
   npm run frontend:install
   npm run frontend:dev
   ```
   UI: `http://localhost:5173` (Vite proxies `/api` → `localhost:3000`)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- USAGE EXAMPLES -->
## Usage

### Mock provider

```bash
VOICE_PROVIDER=mock
MOCK_PROVIDER_DELAY_MS=50
MOCK_PROVIDER_FAILURE_RATE=0
MOCK_AUTO_SIMULATE=true
# Optional overrides (omit to use MOCK_AUTO_SIMULATE_DEFAULTS in code):
# MOCK_AUTO_ANSWER_RATE=0.11
# MOCK_AUTO_MIN_STEP_MS=400
# MOCK_AUTO_MAX_STEP_MS=2000
# MOCK_AUTO_MIN_TALK_MS=1500
# MOCK_AUTO_MAX_TALK_MS=6000
```

`MockVoiceProvider` generates fake IDs, never uses the network, and records create/cancel/disconnect for tests.

When `MOCK_AUTO_SIMULATE=true`, each created call automatically progresses through random statuses. Cancel/disconnect stops the schedule. Manual `POST /calls/:id/simulate` still works. The visualizer Developer Mode includes an **Auto-simulate** toggle that pauses/resumes this at runtime.

### Create and start a session

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

### Simulate call states

```bash
curl -s -X POST localhost:3000/calls/<callAttemptId>/simulate \
  -H 'content-type: application/json' \
  -d '{"status":"ringing"}'

curl -s -X POST localhost:3000/calls/<callAttemptId>/simulate \
  -H 'content-type: application/json' \
  -d '{"status":"in_progress"}'
```

Supported simulate statuses: `queued`, `initiated`, `ringing`, `in_progress`, `completed`, `busy`, `failed`, `no_answer`, `canceled`, `unknown`.

### Visualizer workflow

1. Create a session with contact list and concurrency limit
2. Start dialing — watch the concurrency board fill
3. Select calls with checkboxes and apply status to the selection, use **All active**, or drive each slot individually
4. `in_progress` triggers winner selection and cancels other legs

### Migrations

```bash
# Optional direct Postgres URL — not used by the running API
DATABASE_URL=… npm run db:migrate
```

- `migrations/001_dialer_schema.sql` — tables / constraints  
- `migrations/002_dialer_supabase_rpcs.sql` — `dialer_*` RPCs (claim, winner, create session, …)

Runtime uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` only (no `DATABASE_URL`).

### Tests

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration   # requires Supabase env + RPCs applied; otherwise skipped
```

Unit tests do not need `DATABASE_URL`. Integration tests call Supabase RPCs via the service role.

### Recovery & shutdown

On startup, sessions in `running`, `winner_selected`, or `stopping` are rebuilt (controllers, semaphores, reconcile / cancel cleanup, fail stuck `creating` attempts).

`SIGTERM` / `SIGINT`: stop accepting work, close HTTP, exit. Persisted sessions are retained in Supabase.

Optional auth: set `SERVICE_API_KEY` and send `Authorization: Bearer <key>` (health stays open).

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## API Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness + DB check |
| `POST` | `/sessions` | Create session + contacts |
| `GET` | `/sessions/:id` | Session row |
| `GET` | `/sessions/:id/status` | Poll snapshot; `?afterVersion=` → `204` if unchanged |
| `GET` | `/sessions/:id/reconcile-hint` | Session status + persisted active/queued counts |
| `GET` | `/sessions/:id/contacts` | Paginated contacts |
| `GET` | `/sessions/:id/calls` | Paginated attempts |
| `GET` | `/sessions/:id/events` | Paginated events |
| `POST` | `/sessions/:id/start` | Mark `running` / continue after winner (client schedules reconcile) |
| `POST` | `/sessions/:id/claim` | Atomically claim contacts (`{ "limit": n }`) |
| `PATCH` | `/sessions/:id/auto-continue` | Toggle `{ "autoContinue": true \| false }` mid-session |
| `POST` | `/sessions/:id/pause` | Stop launches; cancel actives |
| `POST` | `/sessions/:id/resume` | Resume from paused (client schedules reconcile) |
| `POST` | `/sessions/:id/stop` | Idempotent stop |
| `POST` | `/calls/:callAttemptId/report-status` | Validated status + winner/complete; may set `triggeredReconcile` |
| `POST` | `/calls/:callAttemptId/created` | After client dial: `creating` → `queued` |
| `POST` | `/calls/:callAttemptId/creation-failed` | Mark failed + release durable permit |
| `POST` | `/calls/:callAttemptId/simulate` | Alias of `report-status` |
| `GET` | `/mock/auto-simulate` | Auto-simulate availability, enabled flag, and config |
| `PATCH` | `/mock/auto-simulate` | Pause/resume, reset defaults, or patch config |

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ROADMAP -->
## Roadmap

- [ ] Real Twilio `VoiceProvider` + webhook signature validation
- [ ] Multi-instance admission (DB-backed leases / distributed limiter)
- [ ] WebSockets for live session updates
- [ ] AMD / conference bridging

**Known limitations today**

- Single Node process only (in-memory controllers / semaphores)
- Mock voice provider only (no real Twilio network calls)
- No WebSockets, AMD, conference bridging, or multi-region lease coordination

**Twilio integration path**

1. Implement `TwilioVoiceProvider` against the same `VoiceProvider` interface
2. Add webhook signature validation on `/webhooks/twilio/status`
3. Map Twilio status payloads into `CallStatusProcessor.processStatus`
4. Keep orchestrator and repositories unchanged

See the [open issues](https://github.com/daniel-citrus/concurrent-outbound-dialer/issues) for a full list of proposed features (and known issues).

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- CONTRIBUTING -->
## Contributing

Contributions are welcome. Fork the repo and open a pull request, or file an issue with the tag `enhancement`.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Top contributors

<a href="https://github.com/daniel-citrus/concurrent-outbound-dialer/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=daniel-citrus/concurrent-outbound-dialer" alt="contrib.rocks image" />
</a>



<!-- CONTACT -->
## Contact

Project Link: [https://github.com/daniel-citrus/concurrent-outbound-dialer](https://github.com/daniel-citrus/concurrent-outbound-dialer)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- ACKNOWLEDGMENTS -->
## Acknowledgments

* [Best-README-Template](https://github.com/othneildrew/Best-README-Template)
* [async-mutex](https://github.com/DirtyHairy/async-mutex)
* [shadcn-svelte](https://www.shadcn-svelte.com/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/daniel-citrus/concurrent-outbound-dialer.svg?style=for-the-badge
[contributors-url]: https://github.com/daniel-citrus/concurrent-outbound-dialer/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/daniel-citrus/concurrent-outbound-dialer.svg?style=for-the-badge
[forks-url]: https://github.com/daniel-citrus/concurrent-outbound-dialer/network/members
[stars-shield]: https://img.shields.io/github/stars/daniel-citrus/concurrent-outbound-dialer.svg?style=for-the-badge
[stars-url]: https://github.com/daniel-citrus/concurrent-outbound-dialer/stargazers
[issues-shield]: https://img.shields.io/github/issues/daniel-citrus/concurrent-outbound-dialer.svg?style=for-the-badge
[issues-url]: https://github.com/daniel-citrus/concurrent-outbound-dialer/issues
[TypeScript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
[Node.js]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[Node-url]: https://nodejs.org/
[Fastify]: https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white
[Fastify-url]: https://fastify.dev/
[PostgreSQL]: https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[PostgreSQL-url]: https://www.postgresql.org/
[Svelte.dev]: https://img.shields.io/badge/Svelte-4A4A55?style=for-the-badge&logo=svelte&logoColor=FF3E00
[Svelte-url]: https://svelte.dev/
[Vite]: https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white
[Vite-url]: https://vite.dev/
[TailwindCSS]: https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwindcss&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
