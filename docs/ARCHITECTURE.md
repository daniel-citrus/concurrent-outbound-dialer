# Architecture

## 1. Multiple-session runtime

One Node process runs many sessions in parallel. PostgreSQL holds durable state; each session gets its own in-memory controller with an isolated semaphore and reconciliation mutex.

```mermaid
flowchart LR
  API[Fastify REST API]
  PG[(PostgreSQL)]

  subgraph Process["Node.js dialer process"]
    SM[SessionManager]
    Orch[SessionOrchestrator]
    CSP[CallStatusProcessor]
    WS[WinnerSelector]
    VP[VoiceProvider / Mock]

    subgraph SA["Session A"]
      CtrlA[SessionController]
      SemA["Semaphore(4)"]
      MuxA[Reconciliation mutex]
      CallsA[Active calls map]
      CtrlA --> SemA
      CtrlA --> MuxA
      CtrlA --> CallsA
    end

    subgraph SB["Session B"]
      CtrlB[SessionController]
      SemB["Semaphore(3)"]
      MuxB[Reconciliation mutex]
      CallsB[Active calls map]
      CtrlB --> SemB
      CtrlB --> MuxB
      CtrlB --> CallsB
    end

    SM --> CtrlA
    SM --> CtrlB
    Orch --> SM
    Orch --> VP
    CSP --> SM
    CSP --> WS
  end

  API --> Orch
  API --> CSP
  Orch --> PG
  CSP --> PG
  WS --> PG
```

Session A's saturated semaphore never blocks Session B.

## 2. Session controller internals

Per-session runtime state only: admission control (semaphore), serialized reconciliation (mutex), and a map of active calls with permit handles. The contact queue lives in PostgreSQL, not here.

```mermaid
flowchart LR
  SC[SessionController]
  SC --> Meta[sessionId / clientId / agentId / status]
  SC --> Sem[async-mutex Semaphore]
  SC --> Mux[async-mutex reconciliation Mutex]
  SC --> ACM["activeCalls Map"]
  ACM --> ACS["callAttemptId, providerCallId, releasePermit, permitReleased"]
```

## 3. End-to-end lifecycle

The happy path from create to completion: persist a session, start dialing, fill concurrency, react to call status, then either pick a winner or dial the next contact. Reconciliation runs only while status is `running`.

```mermaid
sequenceDiagram
  participant UI
  participant SessionService
  participant DB
  participant SessionManager
  participant Orchestrator
  participant StatusProcessor
  participant WinnerSelector

  UI->>SessionService: Create session
  SessionService->>DB: session + queued contacts

  UI->>SessionService: Start
  SessionService->>DB: status = running
  SessionService->>SessionManager: getOrCreate(controller)
  SessionService->>Orchestrator: scheduleReconcile

  Orchestrator->>SessionManager: getOrCreate
  Orchestrator->>DB: claim contacts + reserve attempts
  Orchestrator->>Orchestrator: acquire permits + createCall

  Note over StatusProcessor: Twilio / simulate webhook
  StatusProcessor->>DB: update attempt status

  alt in_progress
    StatusProcessor->>WinnerSelector: selectWinner
    WinnerSelector->>DB: atomic winner claim
    Note over Orchestrator: reconcile no-ops (not running)
  else terminal non-winner
    StatusProcessor->>SessionManager: release permit
    StatusProcessor->>Orchestrator: scheduleReconcile
    Orchestrator->>DB: claim + dial next contacts
  end
```

## 4. What happens when you press Start

Start is a fast HTTP transition: mark the session `running`, ensure a controller exists, schedule reconciliation, and return. Actual dialing happens asynchronously in a microtask after the response.

```mermaid
sequenceDiagram
  autonumber
  actor U as User / UI
  participant API as Fastify<br/>POST /sessions/:id/start
  participant Svc as SessionService
  participant DB as PostgreSQL
  participant SM as SessionManager
  participant Ctrl as SessionController
  participant Orch as SessionOrchestrator
  participant VP as MockVoiceProvider

  U->>API: Start
  API->>Svc: start(sessionId)

  Note over Svc: Allow only from created or paused
  Svc->>DB: UPDATE status = running<br/>bump state_version
  Svc->>DB: INSERT dial_event session_started
  Svc->>SM: getOrCreate(sessionId)
  SM-->>Ctrl: controller (semaphore = concurrency_limit)
  Svc->>Orch: scheduleReconcile(sessionId)
  Svc-->>API: session row (running)
  API-->>U: 200 - UI resumes polling

  Note over Orch: Async microtask - not on the HTTP request
  Orch->>SM: getOrCreate(sessionId)
  Orch->>Ctrl: lock reconciliationMutex

  Orch->>DB: reload session
  alt status is not running
    Orch->>Ctrl: unlock mutex
  else status is running
    Orch->>DB: count active/reserved attempts
    Note over Orch,Ctrl: launchCount = min(<br/>limit - DB actives,<br/>local free permits)
    Orch->>DB: BEGIN<br/>claim queued contacts FOR UPDATE SKIP LOCKED<br/>mark claimed + insert call_attempts creating<br/>COMMIT
    Orch->>Ctrl: unlock mutex

    par for each reserved attempt (<= concurrency)
      Orch->>Ctrl: acquire semaphore permit
      Orch->>VP: createCall(...)
      VP-->>Orch: providerCallId (mock_...)
      Orch->>DB: attempt -> queued + provider_call_id<br/>contact -> dialing<br/>event call_created
    end
  end

  Note over U,DB: Calls stay queued/ringing until<br/>POST /calls/:id/simulate (or a future Twilio webhook)
```

### Start vs dial (split of responsibilities)

| Phase | When | What |
| --- | --- | --- |
| **Synchronous (HTTP)** | During Start click | Validate transition -> persist `running` -> ensure controller -> schedule reconcile -> return |
| **Asynchronous** | Right after response | Mutex -> capacity math -> claim contacts in Postgres -> acquire permits -> `VoiceProvider.createCall` |
| **Later** | Simulate / webhook | Status processor advances ringing / answer / terminal; winner selection; more reconcile |

The Start button does **not** wait for the provider. The mock provider only creates fake IDs; ring/answer still come from `/simulate`.

## 5. Reconciliation flow

Reconciliation fills unused concurrency: lock the session mutex, claim contacts in Postgres, release the mutex, then acquire permits and call the voice provider. Triggered on start, resume, and terminal non-winner statuses.

```mermaid
sequenceDiagram
  participant T as Trigger
  participant O as SessionOrchestrator
  participant M as SessionManager
  participant C as SessionController
  participant DB as PostgreSQL
  participant V as VoiceProvider

  T->>O: scheduleReconcile(sessionId)
  O->>M: getOrCreate(sessionId)
  O->>C: acquire reconciliationMutex
  O->>DB: reload session + count actives
  alt status != running
    O->>C: release mutex
  else capacity available
    O->>DB: claim contacts + insert creating attempts
    O->>C: release mutex
    par launch bounded by concurrency
      O->>C: acquire semaphore permit
      O->>V: createCall
      O->>DB: store provider_call_id, contact dialing
    end
  end
```

Provider calls always happen outside the DB transaction and outside the mutex.

## 6. Semaphore permit lifecycle

Each in-flight call holds one semaphore permit from `createCall` until creation fails or the attempt reaches a terminal status. Release is idempotent via `permit_released` in the DB and a local flag on the controller.

```mermaid
stateDiagram-v2
  [*] --> Free
  Free --> Held: acquire before createCall
  Held --> Held: queued / initiated / ringing / in_progress
  Held --> Free: creation failed OR terminal status
  note right of Free
    release is idempotent
    via permit_released + local flag
  end note
```

## 7. Contact claiming transaction

Contacts are claimed atomically in Postgres before any provider call. `FOR UPDATE SKIP LOCKED` lets concurrent reconcilers safely pull the next batch without double-dialing.

```mermaid
flowchart TB
  A["SELECT queued contacts\nFOR UPDATE SKIP LOCKED\nORDER BY position LIMIT n"] --> B["UPDATE status = claimed"]
  B --> C["INSERT call_attempts status = creating"]
  C --> D["INSERT contact_claimed + call_reserved events"]
  D --> E[COMMIT]
  E --> F["Acquire permits + createCall outside txn"]
```

## 8. Winner-selection race

When a call goes `in_progress`, the first attempt to atomically set `sessions.winning_call_attempt_id` wins. Losers are disconnected; non-winners are cancelled. The semaphore does not choose the winner — PostgreSQL does.

```mermaid
sequenceDiagram
  participant A as Attempt A in_progress
  participant B as Attempt B in_progress
  participant DB as PostgreSQL
  participant W as WinnerSelector
  participant CC as CallCanceler

  A->>W: selectWinner(A)
  B->>W: selectWinner(B)
  W->>DB: UPDATE sessions SET winner WHERE running AND winner IS NULL
  alt A wins
    DB-->>W: row returned
    W->>DB: mark is_winner, contact answered
    W->>CC: cancel/disconnect non-winners
  else B loses
    DB-->>W: no row
    W->>DB: losing_answer_detected
    W->>CC: disconnect B
  end
```

## 9. Controller creation and removal lifecycle

Controllers are created lazily on first use and restored from Postgres on process restart. They are removed only after the session reaches a terminal status and all local work (active calls, permits, reconciliation) is idle.

```mermaid
stateDiagram-v2
  [*] --> Absent
  Absent --> Creating: getOrCreate
  Creating --> Active: load session + restore permits
  Active --> Active: reconcile / status / pause / resume
  Active --> Removable: session terminal AND no active work
  Removable --> Absent: removeIfInactive
```
