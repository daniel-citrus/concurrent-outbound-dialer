# Implementation Checklist

Replace the missing dialer-prototype backend with a multi-session concurrent outbound dialer service. The previous `src/`, `migrations/`, and `tests/` trees were absent; tooling (`package.json`, TypeScript, Vitest, Docker Compose) was retained and adapted.

The existing Svelte frontend was removed (spec: no frontend; API is `/sessions`-based).

## Conventions preserved

- Node 22 + TypeScript `strict` / NodeNext modules
- Fastify 5, `pg`, Zod, Pino, Vitest
- `docker compose` Postgres on port 5432
- `npm run typecheck|lint|test|db:migrate` scripts

## Phases

- [x] 1. Repository inspection and implementation checklist
- [x] 2. Tooling and environment validation (`async-mutex`, env schema, Dockerfile, remove Twilio)
- [x] 3. Replacement database migration (four tables; drop obsolete dialer tables)
- [x] 4. Domain models and state-transition helpers
- [x] 5. Repository layer
- [x] 6. `VoiceProvider` interface
- [x] 7. `MockVoiceProvider`
- [x] 8. `SessionController`
- [x] 9. `SessionManager`
- [x] 10. Session creation and query endpoints
- [x] 11. Contact claiming transaction
- [x] 12. Session orchestrator
- [x] 13. Semaphore permit tracking
- [x] 14. Status simulation and processing
- [x] 15. Winner selection
- [x] 16. Cancellation behavior
- [x] 17. Pause, resume, and stop
- [x] 18. Polling status endpoint
- [x] 19. Recovery service
- [x] 20. Graceful shutdown
- [x] 21. Unit tests
- [x] 22. Integration tests
- [x] 23. Documentation and diagrams (`README.md`, `ARCHITECTURE.md`)

## Verification

```bash
npm run typecheck
npm run lint
npm test
```

All three pass as of this implementation.

## Notes

- No unrelated non-dialer tables were present; only dialer tables were dropped/replaced.
- Provider is mock-only; `TwilioVoiceProvider` is intentionally unimplemented.
- One controller / semaphore / mutex per session; never global.
