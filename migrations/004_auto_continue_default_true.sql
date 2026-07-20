BEGIN;

ALTER TABLE dialing_sessions
  ALTER COLUMN auto_continue SET DEFAULT TRUE;

COMMIT;
