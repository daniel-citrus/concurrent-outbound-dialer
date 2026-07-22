<!-- Improved compatibility of back to top link: See: https://github.com/othneildrew/Best-README-Template/pull/73 -->
<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
[![TypeScript][typescript-shield]][typescript-url]
[![Node.js][nodejs-shield]][nodejs-url]
[![Fastify][fastify-shield]][fastify-url]
[![PostgreSQL][postgres-shield]][postgres-url]
[![Svelte][svelte-shield]][svelte-url]
[![Vite][vite-shield]][vite-url]
[![Tailwind CSS][tailwind-shield]][tailwind-url]



<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h3 align="center">Concurrent Outbound Dialer</h3>

  <p align="center">
    Standalone concurrent outbound dialer — one Node.js process, many independent dialing sessions, with a Svelte visualizer for mock-driven testing.
    <br />
    <a href="./docs/ARCHITECTURE.md"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="./docs/ARCHITECTURE.md">Architecture</a>
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

One Node.js process hosts many independent dialing sessions. Each session has its own controller, semaphore, reconciliation mutex, contact batch, and active-call map.

PostgreSQL is the durable source of truth for sessions, ordered contacts, call attempts, and append-only events. In-memory `async-mutex` semaphores provide per-session admission control inside a single process. A Svelte visualizer drives the mock voice provider for local testing.

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for Mermaid diagrams.

### Architecture Overview

```text
Dialer Service
└── SessionManager (Map<sessionId, SessionController>)
    ├── Session A Controller — Semaphore(4), Mutex, active calls, batch
    ├── Session B Controller — Semaphore(3), Mutex, active calls, batch
    └── ...
```

**Session controller**

- Created lazily via `SessionManager.getOrCreate(sessionId)` from persisted session state
- Restored with one semaphore permit per persisted active/reserved attempt
- Not removed when an agent stops polling
- Removed only when the session is `stopped` / `completed` / `failed`, no active calls remain, no permits are held, and reconciliation is idle

**Session manager**

Singleton `InMemorySessionManager` keyed by `sessionId`. Concurrent `getOrCreate` calls for the same id share one initialization promise so only one controller is created.

**Semaphore**

- Capacity equals `concurrency_limit` (1–15)
- Acquire before calling the voice provider; hold through `creating` → `in_progress`
- Release on terminal outcomes or creation failure (idempotent via `permit_released` + local flag)
- Do not queue all remaining contacts as waiters — DB retains queued contacts until capacity opens

**Mutex**

Each controller has a reconciliation mutex. It serializes short DB work (load state, count actives, claim contacts, reserve attempts). It is **not** held while ringing, waiting for callbacks, or calling the provider.

**PostgreSQL**

- Durable contact queue with `FOR UPDATE SKIP LOCKED` claiming
- Atomic winner selection (`UPDATE … WHERE status = 'running' AND winning_call_attempt_id IS NULL`)
- Partial unique index: one active session per `client_id`
- Partial unique index: one winner per session
- Append-only `dial_events` history

| Table | Purpose |
| --- | --- |
| `dialing_sessions` | Session lifecycle, concurrency, winner |
| `dialing_contacts` | Ordered durable batch |
| `call_attempts` | Reserved/active attempts + `permit_released` |
| `dial_events` | Lifecycle / diagnostic events |

**Provider abstraction**

```ts
interface VoiceProvider {
  createCall(input): Promise<{ providerCallId; status: "queued" }>
  cancelCall(providerCallId): Promise<void>
  disconnectCall(providerCallId): Promise<void>
}
```

Business logic stays provider-neutral (`provider_call_id`, not Twilio SIDs).

<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Built With

* [![TypeScript][typescript-shield]][typescript-url]
* [![Node.js][nodejs-shield]][nodejs-url]
* [![Fastify][fastify-shield]][fastify-url]
* [![PostgreSQL][postgres-shield]][postgres-url]
* [![Svelte][svelte-shield]][svelte-url]
* [![Vite][vite-shield]][vite-url]
* [![Tailwind CSS][tailwind-shield]][tailwind-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

* Node.js 22+
* Docker (for Postgres)
* npm

### Installation

1. Clone the repo
   ```sh
   git clone git@github.com:daniel-citrus/concurrent-outbound-dialer.git
   cd concurrent-outbound-dialer
   ```
2. Start Postgres and configure env
   ```sh
   docker compose up -d postgres
   cp .env.example .env
   ```
3. Install dependencies and migrate
   ```sh
   npm install
   npm run db:migrate
   ```
4. Start the API
   ```sh
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
npm run db:migrate
```

Migrations live in `migrations/` and are tracked in `schema_migrations`.

### Tests

```bash
npm run typecheck
npm run lint
npm test
npm run test:unit
npm run test:integration
```

Integration tests use the real Postgres instance from Docker Compose and `MockVoiceProvider`.

### Recovery & shutdown

On startup, sessions in `running`, `winner_selected`, or `stopping` are rebuilt (controllers, semaphores, reconcile / cancel cleanup, fail stuck `creating` attempts).

`SIGTERM` / `SIGINT`: stop accepting work, close HTTP, close the PG pool, exit. Persisted sessions are retained.

Optional auth: set `SERVICE_API_KEY` and send `Authorization: Bearer <key>` (health stays open).

<p align="right">(<a href="#readme-top">back to top</a>)</p>



## API Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness + DB check |
| `POST` | `/sessions` | Create session + contacts |
| `GET` | `/sessions/:id` | Session row |
| `GET` | `/sessions/:id/status` | Poll snapshot; `?afterVersion=` → `204` if unchanged |
| `GET` | `/sessions/:id/contacts` | Paginated contacts |
| `GET` | `/sessions/:id/calls` | Paginated attempts |
| `GET` | `/sessions/:id/events` | Paginated events |
| `POST` | `/sessions/:id/start` | Start dialing, resume from paused, or continue after winner |
| `PATCH` | `/sessions/:id/auto-continue` | Toggle `{ "autoContinue": true \| false }` mid-session |
| `POST` | `/sessions/:id/pause` | Stop launches; cancel actives |
| `POST` | `/sessions/:id/resume` | Resume from paused |
| `POST` | `/sessions/:id/stop` | Idempotent stop |
| `POST` | `/calls/:callAttemptId/simulate` | Mock status events |
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
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[typescript-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[typescript-url]: https://www.typescriptlang.org/
[nodejs-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[nodejs-url]: https://nodejs.org/
[fastify-shield]: https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white
[fastify-url]: https://fastify.dev/
[postgres-shield]: https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[postgres-url]: https://www.postgresql.org/
[svelte-shield]: https://img.shields.io/badge/Svelte-4A4A55?style=for-the-badge&logo=svelte&logoColor=FF3E00
[svelte-url]: https://svelte.dev/
[vite-shield]: https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white
[vite-url]: https://vite.dev/
[tailwind-shield]: https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwindcss&logoColor=white
[tailwind-url]: https://tailwindcss.com/
