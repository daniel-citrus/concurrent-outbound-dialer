-- Dialer Supabase RPCs: move atomic claim / winner / session create into Postgres.
-- Additive only. Apply after 001_dialer_schema.sql.
-- Runtime dialer service calls these via supabase-js service role (.rpc).

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_active_attempt_statuses()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'creating',
    'queued',
    'initiated',
    'ringing',
    'in_progress'
  ]::text[];
$$;

-- ---------------------------------------------------------------------------
-- dialer_create_session
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_create_session(
  p_client_id text,
  p_agent_id text,
  p_concurrency_limit integer,
  p_auto_continue boolean DEFAULT true,
  p_contacts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session dialing_sessions%ROWTYPE;
  v_contact dialing_contacts%ROWTYPE;
  v_contacts jsonb := '[]'::jsonb;
  v_item jsonb;
  v_idx integer := 0;
BEGIN
  IF p_contacts IS NULL OR jsonb_typeof(p_contacts) <> 'array' OR jsonb_array_length(p_contacts) < 1 THEN
    RAISE EXCEPTION 'contacts array required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO dialing_sessions (client_id, agent_id, status, concurrency_limit, auto_continue)
  VALUES (p_client_id, p_agent_id, 'created', p_concurrency_limit, COALESCE(p_auto_continue, true))
  RETURNING * INTO v_session;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_contacts)
  LOOP
    INSERT INTO dialing_contacts (
      session_id, external_contact_id, phone_number, position, status
    ) VALUES (
      v_session.id,
      v_item->>'externalContactId',
      v_item->>'phoneNumber',
      v_idx,
      'queued'
    )
    RETURNING * INTO v_contact;

    v_contacts := v_contacts || jsonb_build_array(to_jsonb(v_contact));
    v_idx := v_idx + 1;
  END LOOP;

  INSERT INTO dial_events (session_id, event_type, payload)
  VALUES (
    v_session.id,
    'session_created',
    jsonb_build_object(
      'clientId', v_session.client_id,
      'agentId', v_session.agent_id,
      'contactCount', v_idx,
      'concurrencyLimit', v_session.concurrency_limit
    )
  );

  RETURN jsonb_build_object(
    'session', to_jsonb(v_session),
    'contacts', v_contacts
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate active session for client %', p_client_id
      USING ERRCODE = '23505';
END;
$$;

-- ---------------------------------------------------------------------------
-- dialer_claim_contacts (FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_claim_contacts(
  p_session_id uuid,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH claimed AS (
    SELECT id
    FROM dialing_contacts
    WHERE session_id = p_session_id
      AND status = 'queued'
    ORDER BY position
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  updated_contacts AS (
    UPDATE dialing_contacts dc
    SET
      status = 'claimed',
      claimed_at = NOW(),
      updated_at = NOW()
    FROM claimed
    WHERE dc.id = claimed.id
    RETURNING dc.*
  ),
  inserted_attempts AS (
    INSERT INTO call_attempts (session_id, contact_id, status)
    SELECT p_session_id, uc.id, 'creating'
    FROM updated_contacts uc
    RETURNING *
  ),
  contact_events AS (
    INSERT INTO dial_events (session_id, call_attempt_id, event_type, payload)
    SELECT
      p_session_id,
      ia.id,
      'contact_claimed',
      jsonb_build_object('contactId', uc.id, 'position', uc.position)
    FROM updated_contacts uc
    JOIN inserted_attempts ia ON ia.contact_id = uc.id
  ),
  attempt_events AS (
    INSERT INTO dial_events (session_id, call_attempt_id, event_type, payload)
    SELECT
      p_session_id,
      ia.id,
      'call_reserved',
      jsonb_build_object('contactId', ia.contact_id)
    FROM inserted_attempts ia
  ),
  paired AS (
    SELECT
      jsonb_build_object(
        'contact', to_jsonb(uc),
        'call_attempt', to_jsonb(ia)
      ) AS item,
      uc.position
    FROM updated_contacts uc
    JOIN inserted_attempts ia ON ia.contact_id = uc.id
    ORDER BY uc.position
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY position), '[]'::jsonb)
  INTO v_result
  FROM paired;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- dialer_try_select_winner
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_try_select_winner(
  p_session_id uuid,
  p_call_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session dialing_sessions%ROWTYPE;
BEGIN
  UPDATE dialing_sessions
  SET
    status = 'winner_selected',
    winning_call_attempt_id = p_call_attempt_id,
    paused_at = NOW(),
    state_version = state_version + 1,
    updated_at = NOW()
  WHERE id = p_session_id
    AND status = 'running'
    AND winning_call_attempt_id IS NULL
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_session);
END;
$$;

-- ---------------------------------------------------------------------------
-- dialer_continue_from_winner
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_continue_from_winner(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session dialing_sessions%ROWTYPE;
BEGIN
  UPDATE dialing_sessions
  SET
    status = 'running',
    winning_call_attempt_id = NULL,
    paused_at = NULL,
    state_version = state_version + 1,
    updated_at = NOW()
  WHERE id = p_session_id
    AND status = 'winner_selected'
    AND winning_call_attempt_id IS NOT NULL
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_session);
END;
$$;

-- ---------------------------------------------------------------------------
-- dialer_reconcile_hint
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_reconcile_hint(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_session dialing_sessions%ROWTYPE;
  v_active integer;
  v_queued integer;
  v_claimed integer;
BEGIN
  SELECT * INTO v_session FROM dialing_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*)::integer INTO v_active
  FROM call_attempts
  WHERE session_id = p_session_id
    AND status = ANY (dialer_active_attempt_statuses());

  SELECT COUNT(*)::integer INTO v_queued
  FROM dialing_contacts
  WHERE session_id = p_session_id AND status = 'queued';

  SELECT COUNT(*)::integer INTO v_claimed
  FROM dialing_contacts
  WHERE session_id = p_session_id AND status = 'claimed';

  RETURN jsonb_build_object(
    'sessionId', v_session.id,
    'sessionStatus', v_session.status,
    'concurrencyLimit', v_session.concurrency_limit,
    'persistedActiveCount', v_active,
    'queuedContactCount', v_queued,
    'claimedContactCount', v_claimed
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- dialer_mark_call_created
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_mark_call_created(
  p_call_attempt_id uuid,
  p_provider_call_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt call_attempts%ROWTYPE;
  v_updated call_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM call_attempts WHERE id = p_call_attempt_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE call_attempts
  SET
    status = 'queued',
    provider_call_id = p_provider_call_id,
    updated_at = NOW()
  WHERE id = p_call_attempt_id
    AND status = 'creating'
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    -- Idempotent: return current row
    RETURN to_jsonb(v_attempt);
  END IF;

  UPDATE dialing_contacts
  SET status = 'dialing', updated_at = NOW()
  WHERE id = v_updated.contact_id;

  INSERT INTO dial_events (session_id, call_attempt_id, event_type, payload)
  VALUES (
    v_updated.session_id,
    v_updated.id,
    'call_created',
    jsonb_build_object('providerCallId', p_provider_call_id)
  );

  RETURN to_jsonb(v_updated);
END;
$$;

-- ---------------------------------------------------------------------------
-- dialer_mark_call_creation_failed
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_mark_call_creation_failed(
  p_call_attempt_id uuid,
  p_error_code text DEFAULT 'PROVIDER_FAILURE',
  p_error_message text DEFAULT 'provider failure'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt call_attempts%ROWTYPE;
  v_updated call_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_attempt FROM call_attempts WHERE id = p_call_attempt_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE call_attempts
  SET
    status = 'failed',
    error_code = COALESCE(p_error_code, 'PROVIDER_FAILURE'),
    error_message = COALESCE(p_error_message, 'provider failure'),
    completed_at = NOW(),
    permit_released = TRUE,
    updated_at = NOW()
  WHERE id = p_call_attempt_id
    AND status = 'creating'
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RETURN to_jsonb(v_attempt);
  END IF;

  UPDATE dialing_contacts
  SET status = 'failed', completed_at = NOW(), updated_at = NOW()
  WHERE id = v_updated.contact_id;

  INSERT INTO dial_events (session_id, call_attempt_id, event_type, payload)
  VALUES (
    v_updated.session_id,
    v_updated.id,
    'call_creation_failed',
    jsonb_build_object(
      'error', COALESCE(p_error_message, 'provider failure'),
      'code', COALESCE(p_error_code, 'PROVIDER_FAILURE')
    )
  );

  RETURN to_jsonb(v_updated);
END;
$$;

-- ---------------------------------------------------------------------------
-- Test helper (service_role only) — truncate dialer tables between tests
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION dialer_test_truncate()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE dial_events, call_attempts, dialing_contacts, dialing_sessions
    RESTART IDENTITY CASCADE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role when present (hosted Supabase); postgres for local
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION dialer_active_attempt_statuses() FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_create_session(text, text, integer, boolean, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_claim_contacts(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_try_select_winner(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_continue_from_winner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_reconcile_hint(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_mark_call_created(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_mark_call_creation_failed(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dialer_test_truncate() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION dialer_active_attempt_statuses() TO postgres;
GRANT EXECUTE ON FUNCTION dialer_create_session(text, text, integer, boolean, jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION dialer_claim_contacts(uuid, integer) TO postgres;
GRANT EXECUTE ON FUNCTION dialer_try_select_winner(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION dialer_continue_from_winner(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION dialer_reconcile_hint(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION dialer_mark_call_created(uuid, text) TO postgres;
GRANT EXECUTE ON FUNCTION dialer_mark_call_creation_failed(uuid, text, text) TO postgres;
GRANT EXECUTE ON FUNCTION dialer_test_truncate() TO postgres;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  dialing_sessions,
  dialing_contacts,
  call_attempts,
  dial_events
TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_active_attempt_statuses() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_create_session(text, text, integer, boolean, jsonb) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_claim_contacts(uuid, integer) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_try_select_winner(uuid, uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_continue_from_winner(uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_reconcile_hint(uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_mark_call_created(uuid, text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_mark_call_creation_failed(uuid, text, text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION dialer_test_truncate() TO service_role';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE dialing_sessions, dialing_contacts, call_attempts, dial_events TO service_role';
  END IF;
END $$;

COMMIT;
