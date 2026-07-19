# Architecture

## 1. Multiple-session runtime

```mermaid
flowchart TB
  subgraph Process["Node.js dialer process"]
    SM[SessionManager]
    Orch[SessionOrchestrator]
    CSP[CallStatusProcessor]
    VP[VoiceProvider / Mock]

    subgraph SA["Session A Controller"]
      SemA["Semaphore(4)"]
      MuxA[Mutex]
      MapA[Active calls]
    end

    subgraph SB["Session B Controller"]
      SemB["Semaphore(3)"]
      MuxB[Mutex]
      MapB[Active calls]
    end

    SM --> SA
    SM --> SB
    Orch --> SM
    Orch --> VP
    CSP --> SM
    CSP --> Orch
  end

  PG[(PostgreSQL)]
  API[Fastify REST API]
  API --> Orch
  API --> CSP
  Orch --> PG
  CSP --> PG
```

Sessions reconcile and dial concurrently. Session A's saturated semaphore never blocks Session B.

## 2. Session controller internals

```mermaid
flowchart LR
  SC[SessionController]
  SC --> Meta[sessionId / clientId / agentId / status]
  SC --> Sem[async-mutex Semaphore]
  SC --> Mux[async-mutex reconciliation Mutex]
  SC --> ACM["activeCalls Map"]
  ACM --> ACS["callAttemptId, providerCallId, releasePermit, permitReleased"]
```

The durable contact queue lives in PostgreSQL (`dialing_contacts`), not in the controller.

## 3. Reconciliation flow

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

## 4. Semaphore permit lifecycle

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

## 5. Contact claiming transaction

```mermaid
flowchart TB
  A["SELECT queued contacts\nFOR UPDATE SKIP LOCKED\nORDER BY position LIMIT n"] --> B["UPDATE status = claimed"]
  B --> C["INSERT call_attempts status = creating"]
  C --> D["INSERT contact_claimed + call_reserved events"]
  D --> E[COMMIT]
  E --> F["Acquire permits + createCall outside txn"]
```

## 6. Winner-selection race

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

The semaphore does not choose the winner — PostgreSQL does.

## 7. Controller creation and removal lifecycle

```mermaid
stateDiagram-v2
  [*] --> Absent
  Absent --> Creating: getOrCreate
  Creating --> Active: load session + restore permits
  Active --> Active: reconcile / status / pause / resume
  Active --> Removable: session terminal AND no active work
  Removable --> Absent: removeIfInactive
```

Controllers survive browser disconnects and polling gaps. Removal is gated on terminal persisted status plus idle local runtime state.
