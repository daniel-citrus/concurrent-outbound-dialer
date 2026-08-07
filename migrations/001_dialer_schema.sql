-- Squashed dialer schema (final shape of former 002–005).
-- Fresh databases: apply as-is. Existing DBs that already ran 002–005 should
-- record this file in schema_migrations instead of re-applying.
BEGIN;

DROP TABLE IF EXISTS dial_events CASCADE;
DROP TABLE IF EXISTS call_attempts CASCADE;
DROP TABLE IF EXISTS dialing_contacts CASCADE;
DROP TABLE IF EXISTS dialing_sessions CASCADE;

-- Legacy / alternate names from earlier prototypes (safe no-ops if absent)
DROP TABLE IF EXISTS batch_events CASCADE;
DROP TABLE IF EXISTS dial_batches CASCADE;
DROP TABLE IF EXISTS batch_contacts CASCADE;
DROP TABLE IF EXISTS dial_batch_contacts CASCADE;
DROP TABLE IF EXISTS batches CASCADE;

CREATE TABLE dialing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  concurrency_limit INTEGER NOT NULL,
  auto_continue BOOLEAN NOT NULL DEFAULT TRUE,
  winning_call_attempt_id UUID,
  state_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dialing_sessions_status_check CHECK (
    status IN (
      'created',
      'running',
      'paused',
      'winner_selected',
      'stopping',
      'stopped',
      'completed',
      'failed'
    )
  ),
  CONSTRAINT dialing_sessions_concurrency_limit_check CHECK (
    concurrency_limit BETWEEN 1 AND 15
  )
);

CREATE INDEX idx_dialing_sessions_client_id ON dialing_sessions (client_id);
CREATE INDEX idx_dialing_sessions_agent_id ON dialing_sessions (agent_id);
CREATE INDEX idx_dialing_sessions_status ON dialing_sessions (status);
CREATE INDEX idx_dialing_sessions_client_agent ON dialing_sessions (client_id, agent_id);

CREATE UNIQUE INDEX one_active_session_per_client
ON dialing_sessions (client_id)
WHERE status IN (
  'created',
  'running',
  'paused',
  'winner_selected',
  'stopping'
);

CREATE TABLE dialing_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES dialing_sessions (id) ON DELETE CASCADE,
  external_contact_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dialing_contacts_status_check CHECK (
    status IN (
      'queued',
      'claimed',
      'dialing',
      'answered',
      'completed',
      'failed',
      'canceled',
      'skipped'
    )
  ),
  CONSTRAINT dialing_contacts_position_check CHECK (position >= 0),
  UNIQUE (session_id, external_contact_id),
  UNIQUE (session_id, position)
);

CREATE INDEX idx_dialing_contacts_session_status_position
ON dialing_contacts (session_id, status, position);

CREATE TABLE call_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES dialing_sessions (id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES dialing_contacts (id) ON DELETE CASCADE,
  provider_call_id TEXT,
  status TEXT NOT NULL,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  permit_released BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT call_attempts_status_check CHECK (
    status IN (
      'creating',
      'queued',
      'initiated',
      'ringing',
      'in_progress',
      'completed',
      'busy',
      'failed',
      'no_answer',
      'canceled',
      'unknown'
    )
  )
);

CREATE UNIQUE INDEX call_attempts_provider_call_id_unique
ON call_attempts (provider_call_id)
WHERE provider_call_id IS NOT NULL;

CREATE INDEX idx_call_attempts_session_status ON call_attempts (session_id, status);
CREATE INDEX idx_call_attempts_contact_id ON call_attempts (contact_id);
CREATE INDEX idx_call_attempts_provider_call_id ON call_attempts (provider_call_id);

-- Multiple winners across rounds allowed; current round pointer is
-- dialing_sessions.winning_call_attempt_id (no one_winner_per_session index).

ALTER TABLE dialing_sessions
  ADD CONSTRAINT fk_dialing_sessions_winning_call_attempt
  FOREIGN KEY (winning_call_attempt_id)
  REFERENCES call_attempts (id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE dial_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES dialing_sessions (id) ON DELETE CASCADE,
  call_attempt_id UUID REFERENCES call_attempts (id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dial_events_session_created ON dial_events (session_id, created_at);
CREATE INDEX idx_dial_events_call_attempt_created ON dial_events (call_attempt_id, created_at);

COMMIT;
