-- Broaden the existing rendezvous health CHECK constraints for the versioned
-- malformed-observation fallback and the split source diagnostics. SQLite does
-- not support altering a CHECK constraint in place, so preserve every row in a
-- forward table rebuild and recreate the existing read index afterward.
ALTER TABLE rendezvous_health_observations
  RENAME TO rendezvous_health_observations_0006;

DROP INDEX IF EXISTS rendezvous_health_observations_received_at;

CREATE TABLE rendezvous_health_observations (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  received_at TEXT NOT NULL CHECK (length(received_at) BETWEEN 1 AND 64),
  observation_generation INTEGER NOT NULL CHECK (
    typeof(observation_generation) = 'integer' AND
    observation_generation BETWEEN 0 AND 9007199254740991
  ),
  source_timestamp INTEGER CHECK (
    source_timestamp IS NULL OR (
      typeof(source_timestamp) = 'integer' AND
      source_timestamp BETWEEN 0 AND 9007199254740991
    )
  ),
  window_started_at INTEGER CHECK (
    window_started_at IS NULL OR (
      typeof(window_started_at) = 'integer' AND
      window_started_at BETWEEN 0 AND 9007199254740991
    )
  ),
  window_ended_at INTEGER CHECK (
    window_ended_at IS NULL OR (
      typeof(window_ended_at) = 'integer' AND
      window_ended_at BETWEEN 0 AND 9007199254740991
    )
  ),
  freshness_state TEXT NOT NULL CHECK (
    freshness_state IN ('fresh', 'stale', 'no_observation')
  ),
  source_status TEXT CHECK (
    source_status IS NULL OR
    source_status IN ('healthy', 'failed', 'stale', 'no_usable_observation')
  ),
  recent_authenticated_admissions INTEGER NOT NULL CHECK (
    typeof(recent_authenticated_admissions) = 'integer' AND
    recent_authenticated_admissions BETWEEN 0 AND 1000000
  ),
  session_total INTEGER NOT NULL CHECK (
    typeof(session_total) = 'integer' AND
    session_total BETWEEN 0 AND 8000000
  ),
  session_completed INTEGER NOT NULL CHECK (
    typeof(session_completed) = 'integer' AND
    session_completed BETWEEN 0 AND 1000000
  ),
  session_client_disconnected INTEGER NOT NULL CHECK (
    typeof(session_client_disconnected) = 'integer' AND
    session_client_disconnected BETWEEN 0 AND 1000000
  ),
  session_expired INTEGER NOT NULL CHECK (
    typeof(session_expired) = 'integer' AND
    session_expired BETWEEN 0 AND 1000000
  ),
  session_protocol_error INTEGER NOT NULL CHECK (
    typeof(session_protocol_error) = 'integer' AND
    session_protocol_error BETWEEN 0 AND 1000000
  ),
  session_server_unavailable INTEGER NOT NULL CHECK (
    typeof(session_server_unavailable) = 'integer' AND
    session_server_unavailable BETWEEN 0 AND 1000000
  ),
  session_server_replaced INTEGER NOT NULL CHECK (
    typeof(session_server_replaced) = 'integer' AND
    session_server_replaced BETWEEN 0 AND 1000000
  ),
  session_authorization_failed INTEGER NOT NULL CHECK (
    typeof(session_authorization_failed) = 'integer' AND
    session_authorization_failed BETWEEN 0 AND 1000000
  ),
  session_internal_error INTEGER NOT NULL CHECK (
    typeof(session_internal_error) = 'integer' AND
    session_internal_error BETWEEN 0 AND 1000000
  ),
  canary_type TEXT NOT NULL CHECK (canary_type IN ('none', 'route', 'end_to_end')),
  canary_route TEXT NOT NULL CHECK (
    canary_route IN ('not_observed', 'reachable', 'failed')
  ),
  canary_authenticated_control TEXT NOT NULL CHECK (
    canary_authenticated_control IN ('not_observed', 'passed', 'failed')
  ),
  canary_recent_admission TEXT NOT NULL CHECK (
    canary_recent_admission IN ('not_observed', 'passed', 'failed')
  ),
  canary_observed_at INTEGER CHECK (
    canary_observed_at IS NULL OR (
      typeof(canary_observed_at) = 'integer' AND
      canary_observed_at BETWEEN 0 AND 9007199254740991
    )
  ),
  reason TEXT CHECK (
    reason IS NULL OR reason IN (
      'no_observation', 'malformed_observation', 'stale_source',
      'canary_failed', 'canary_passed', 'authenticated_admission',
      'completed_session', 'no_positive_evidence'
    )
  ),
  error TEXT CHECK (
    error IS NULL OR error IN (
      'source_not_configured', 'source_unauthorized',
      'source_unavailable', 'source_invalid_headers',
      'source_invalid_payload', 'malformed_source'
    )
  ),
  CHECK (
    session_total = session_completed + session_client_disconnected +
      session_expired + session_protocol_error + session_server_unavailable +
      session_server_replaced + session_authorization_failed + session_internal_error
  ),
  CHECK (
    (canary_type = 'none' AND canary_route = 'not_observed' AND
      canary_authenticated_control = 'not_observed' AND
      canary_recent_admission = 'not_observed' AND canary_observed_at IS NULL)
    OR
    (canary_type = 'route' AND canary_route IN ('reachable', 'failed') AND
      canary_authenticated_control = 'not_observed' AND
      canary_recent_admission = 'not_observed' AND canary_observed_at IS NOT NULL)
    OR
    (canary_type = 'end_to_end' AND canary_route IN ('reachable', 'failed') AND
      canary_observed_at IS NOT NULL AND
      ((canary_route = 'failed' AND
        canary_authenticated_control = 'not_observed' AND
        canary_recent_admission = 'not_observed') OR
       (canary_route = 'reachable' AND
        canary_authenticated_control IN ('passed', 'failed') AND
        canary_recent_admission IN ('passed', 'failed')))
  )),
  CHECK (
    (error IS NOT NULL AND observation_generation = 0 AND
      source_timestamp IS NULL AND window_started_at IS NULL AND
      window_ended_at IS NULL AND freshness_state = 'no_observation' AND
      source_status IS NULL AND recent_authenticated_admissions = 0 AND
      session_total = 0 AND canary_type = 'none' AND reason IS NULL)
    OR
    (error IS NULL AND source_timestamp IS NULL AND
      observation_generation = 0 AND window_started_at IS NULL AND
      window_ended_at IS NULL AND freshness_state = 'no_observation' AND
      source_status = 'no_usable_observation' AND
      recent_authenticated_admissions = 0 AND
      reason IN ('no_observation', 'malformed_observation'))
    OR
    (error IS NULL AND source_timestamp IS NOT NULL AND
      observation_generation >= 1 AND window_started_at IS NOT NULL AND
      window_ended_at IS NOT NULL AND window_ended_at - window_started_at = 300 AND
      source_timestamp >= window_started_at AND
      source_timestamp < window_ended_at AND
      freshness_state IN ('fresh', 'stale') AND source_status IS NOT NULL AND
      reason IS NOT NULL)
  )
);

INSERT INTO rendezvous_health_observations (
  id,
  received_at,
  observation_generation,
  source_timestamp,
  window_started_at,
  window_ended_at,
  freshness_state,
  source_status,
  recent_authenticated_admissions,
  session_total,
  session_completed,
  session_client_disconnected,
  session_expired,
  session_protocol_error,
  session_server_unavailable,
  session_server_replaced,
  session_authorization_failed,
  session_internal_error,
  canary_type,
  canary_route,
  canary_authenticated_control,
  canary_recent_admission,
  canary_observed_at,
  reason,
  error
)
SELECT
  id,
  received_at,
  observation_generation,
  source_timestamp,
  window_started_at,
  window_ended_at,
  freshness_state,
  source_status,
  recent_authenticated_admissions,
  session_total,
  session_completed,
  session_client_disconnected,
  session_expired,
  session_protocol_error,
  session_server_unavailable,
  session_server_replaced,
  session_authorization_failed,
  session_internal_error,
  canary_type,
  canary_route,
  canary_authenticated_control,
  canary_recent_admission,
  canary_observed_at,
  reason,
  error
FROM rendezvous_health_observations_0006;

DROP TABLE rendezvous_health_observations_0006;

CREATE INDEX rendezvous_health_observations_received_at
  ON rendezvous_health_observations (received_at DESC);
