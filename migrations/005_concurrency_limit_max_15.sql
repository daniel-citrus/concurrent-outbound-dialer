-- Raise session concurrency cap from 10 to 15.
ALTER TABLE dialing_sessions
  DROP CONSTRAINT dialing_sessions_concurrency_limit_check;

ALTER TABLE dialing_sessions
  ADD CONSTRAINT dialing_sessions_concurrency_limit_check
  CHECK (concurrency_limit BETWEEN 1 AND 15);
