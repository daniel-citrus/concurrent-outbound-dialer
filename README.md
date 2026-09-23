<a id="readme-top"></a>

[![Issues][issues-shield]][issues-url]

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h3 align="center">Concurrent Outbound Dialer</h3>

  <p align="center">
    A power dialer: fire concurrent calls at a contact list, keep whichever one picks up first, and cancel the rest — automatically.
    <br />
    <br />
    <a href="https://concurrency-dialer.netlify.app/"><strong>Live demo »</strong></a>
    &middot;
    <a href="./docs/ARCHITECTURE.md">Architecture docs</a>
  </p>
</div>

<!-- ABOUT THE PROJECT -->
## About The Project

This is a "power dialer" — the pattern used by sales/support tools like Orum or PhoneBurner: dial N contacts at once per agent, connect the agent to whichever call answers first, and cancel the rest before they ring the agent's phone twice. The interesting engineering problem isn't the UI, it's the concurrency: many calls racing to change shared state (a session's "winner"), a durable queue that must survive a server restart, and a rate limiter that has to be correct even if the dialer is scaled to multiple instances.

The [live demo](https://concurrency-dialer.netlify.app/) runs entirely in the browser — mock agents, mock contact lists, and simulated calls, no backend involved. Pick an agent, start a session, and watch the concurrency board fill, race to a winner, and cancel the rest.

The real system underneath (this repo) is a Fastify API backed by Postgres/Supabase, with the dialing orchestration itself running client-side. See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full design writeup with Mermaid sequence diagrams.

### Why This Project

A few things this repo is meant to demonstrate:

- **Concurrency correctness under a real race condition.** Multiple calls for the same session can all answer near-simultaneously; exactly one may become the "winner." That's enforced with a single conditional `UPDATE ... WHERE winning_call_attempt_id IS NULL` RPC, not application-level locking.
- **Client-owned orchestration, server-owned truth.** Admission control (a per-session semaphore) and dial placement live in the browser; the server only accepts atomic, validated state transitions. This split is documented and justified in [ARCHITECTURE.md](./docs/ARCHITECTURE.md#4-responsibility-split).
- **Provider abstraction over a third-party dependency.** `VoiceProvider` and `ProspectProvider` interfaces mean the mock implementations used here can be swapped for Twilio and a real CRM without touching orchestration code.
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

- **Client orchestrator** — runs in the browser tab (one tab ≈ one session worker); a semaphore admits at most `concurrency_limit` concurrent calls and a mutex serializes claim work.
- **Postgres** — durable contact queue with `FOR UPDATE SKIP LOCKED` claiming, atomic winner selection, and an append-only event log.
- **Call placement** — an injectable `CallPlacer` on the client (mock provider IDs in the demo) and `VoiceProvider` on the server for cancel/disconnect. Prospect data comes from an injectable `ProspectProvider` — mock agents and generated contact lists today, a real CRM later.

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

<!-- CONTACT -->
## Contact

Daniel Calvo — [dandcalvo@gmail.com](mailto:dandcalvo@gmail.com)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
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
