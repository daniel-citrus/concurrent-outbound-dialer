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
    A power dialer: fire concurrent calls at a contact list, keep whichever one picks up first, and cancel the rest — automatically.
    <br />
    <a href="./docs/ARCHITECTURE.md"><strong>Explore the architecture docs »</strong></a>
    <br />
    <br />
    <a href="#getting-started">Run it locally</a>
    &middot;
    <a href="#api-endpoints">API</a>
    &middot;
    <a href="https://github.com/daniel-citrus/concurrent-outbound-dialer/issues/new?labels=bug">Report Bug</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#why-this-project">Why This Project</a></li>
        <li><a href="#architecture-overview">Architecture Overview</a></li>
        <li><a href="./docs/ARCHITECTURE.md">Full Architecture Doc (docs/ARCHITECTURE.md)</a></li>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#connecting-a-real-supabase-project">Connecting a real Supabase project</a></li>
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

This is a "power dialer" — the pattern used by sales/support tools like Orum or PhoneBurner: dial N contacts at once per agent, connect the agent to whichever call answers first, and cancel the rest before they ring the agent's phone twice. The interesting engineering problem isn't the UI, it's the concurrency: many calls racing to change shared state (a session's "winner"), a durable queue that must survive a server restart, and a rate limiter that has to be correct even if the dialer is scaled to multiple instances.

**Full end-to-end demo, zero setup.** Clone it, `npm install`, `npm run dev` — no Twilio account, no Supabase project, no API keys. A mock voice provider simulates ringing → answered → completed in real time, and an in-memory data store stands in for Postgres until you point it at a real Supabase project. Everything — the concurrency control, the atomic winner selection, the durable queue — runs for real; only the phone network and the database are faked.

Run with a real Supabase project instead, and the same code path uses actual Postgres with `FOR UPDATE SKIP LOCKED` claiming and atomic RPCs for the operations that must not race.

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full design writeup with Mermaid sequence diagrams.

### Why This Project

A few things this repo is meant to demonstrate:

- **Concurrency correctness under a real race condition.** Multiple calls for the same session can all answer near-simultaneously; exactly one may become the "winner." That's enforced with a single conditional `UPDATE ... WHERE winning_call_attempt_id IS NULL` RPC, not application-level locking.
- **Client-owned orchestration, server-owned truth.** Admission control (a per-session semaphore) and dial placement live in the browser; the server only accepts atomic, validated state transitions. This split is documented and justified in [ARCHITECTURE.md](./docs/ARCHITECTURE.md#4-responsibility-split).
- **Provider abstraction over a third-party dependency.** `VoiceProvider` and `ProspectProvider` interfaces mean the mock implementations used here can be swapped for Twilio and a real CRM without touching orchestration code — see the [Twilio integration path](#roadmap).
- **Durability and recovery.** Sessions, queued contacts, and call attempts are Postgres rows, not process memory — a server restart mid-session rebuilds in-flight state instead of losing it.
- **Tests that exercise the real race.** The integration suite drives concurrent calls through the actual claim/winner RPCs to verify only one winner is ever selected.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Architecture Overview

```text
Browser (Svelte visualizer)
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
- Does not queue all remaining contacts as waiters — the DB retains queued contacts until capacity opens

**Mutex (client)**

Serializes short claim work (load state, capacity math, `POST /claim`). It is **not** held while ringing or placing a call.

**PostgreSQL (or the in-memory fallback in dev)**

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

Injectable `CallPlacer` on the client (mock provider IDs in the visualizer). Server `VoiceProvider` remains for cancel/disconnect and the integration-test harness. Prospect data comes from an injectable `ProspectProvider` (mock agents + generated contact lists today; swap in a real CRM later).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

* [![TypeScript][TypeScript]][TypeScript-url]
* [![Node.js][Node.js]][Node-url]
* [![Fastify][Fastify]][Fastify-url]
* [![PostgreSQL][PostgreSQL]][PostgreSQL-url]
* [![Supabase][Supabase]][Supabase-url]
* [![Svelte][Svelte.dev]][Svelte-url]
* [![Vite][Vite]][Vite-url]
* [![Tailwind CSS][TailwindCSS]][Tailwind-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* Node.js 22+
* npm

That's it — no database or third-party account is required to run the full demo.

### Installation

1. Clone the repo
   ```sh
   git clone git@github.com:daniel-citrus/concurrent-outbound-dialer.git
   cd concurrent-outbound-dialer
   ```
2. Install and start the API
   ```sh
   npm install
   npm run dev
   ```
   API: `http://localhost:3000` — with no `SUPABASE_URL` configured, it logs `Supabase not configured — using in-memory mock data store` and serves everything from memory.

3. Start the visualizer (in a second terminal)
   ```sh
   npm run frontend:install
   npm run frontend:dev
   ```
   UI: `http://localhost:5173` (Vite proxies `/api` → `localhost:3000`)

4. Open the UI, pick a mock agent, create a session from one of their generated prospect lists, and press Start. Calls will ring and resolve on their own — `MOCK_AUTO_SIMULATE` is on by default.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Connecting a real Supabase project

The in-memory store is a drop-in for local development and demos. To persist data and exercise the real Postgres RPC path instead:

1. Create a Supabase project (or run one locally).
2. Configure env
   ```sh
   cp .env.example .env
   # Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
   ```
3. Apply SQL migrations to that project
   - Dashboard → SQL → run `migrations/001_dialer_schema.sql` then `migrations/002_dialer_supabase_rpcs.sql`
   - Or with a direct DB URL (migrate tooling only):
     ```sh
     DATABASE_URL=postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres npm run db:migrate
     ```
4. Restart `npm run dev` — the API connects on boot and falls back to the in-memory store automatically if the project is unreachable.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

### Mock voice provider

```bash
VOICE_PROVIDER=mock
MOCK_PROVIDER_DELAY_MS=50
MOCK_PROVIDER_FAILURE_RATE=0
MOCK_AUTO_SIMULATE=true
# Optional overrides (omit to use MOCK_AUTO_SIMULATE_DEFAULTS in code):
# MOCK_AUTO_ANSWER_RATE=0.11
# MOCK_AUTO_MIN_STEP_MS=1500
# MOCK_AUTO_MAX_STEP_MS=6000
# MOCK_AUTO_MIN_TALK_MS=60000
# MOCK_AUTO_MAX_TALK_MS=300000
```

`MockVoiceProvider` generates fake call IDs, never touches the network, and records create/cancel/disconnect for tests.

When `MOCK_AUTO_SIMULATE=true`, each created call automatically progresses through random statuses on a realistic timeline. Cancel/disconnect stops the schedule. Manual `POST /calls/:id/simulate` still works. The visualizer's Developer Mode includes an **Auto-simulate** toggle that pauses/resumes this at runtime.

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

1. Pick a mock agent and one of their generated prospect lists
2. Set a concurrency limit and start the session — watch the concurrency board fill
3. Select calls with checkboxes and apply a status to the selection, use **All active**, or drive each slot individually
4. `in_progress` triggers winner selection and cancels the other legs

### Tests

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration   # requires a real Supabase project + RPCs applied; otherwise skipped
```

Unit tests run against the in-memory store. Integration tests exercise the actual `dialer_*` RPCs against Supabase, including the winner-selection race.

### Recovery & shutdown

On startup, sessions in `running`, `winner_selected`, or `stopping` are rebuilt (controllers, semaphores, reconcile / cancel cleanup, fail stuck `creating` attempts).

`SIGTERM` / `SIGINT`: stop accepting work, close HTTP, exit. Persisted sessions are retained in Supabase (or lost with the process if running on the in-memory store).

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
| `GET` | `/prospects/agents` | List mock agents (swap for a real CRM via `ProspectProvider`) |
| `GET` | `/prospects/agents/:agentId/lists` | Prospect lists for an agent |
| `GET` | `/prospects/lists/:listId/contacts` | Contacts in a prospect list |
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

This started as a solo portfolio project, but contributions are welcome. Fork the repo and open a pull request, or file an issue with the tag `enhancement`.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- CONTACT -->
## Contact

Daniel Calvo — [dandcalvo@gmail.com](mailto:dandcalvo@gmail.com)

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
[Supabase]: https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white
[Supabase-url]: https://supabase.com/
[Svelte.dev]: https://img.shields.io/badge/Svelte-4A4A55?style=for-the-badge&logo=svelte&logoColor=FF3E00
[Svelte-url]: https://svelte.dev/
[Vite]: https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white
[Vite-url]: https://vite.dev/
[TailwindCSS]: https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwindcss&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
