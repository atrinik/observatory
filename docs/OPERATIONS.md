# Operator runbook

## Read the dashboard

`GET /api/status` is a projection, not a replacement for GitHub. Use the direct
evidence link for the workflow log, failed job, check, release, asset, or
deployment. Interpret statuses as follows:

- `passed`: the latest event-driven evidence was explicitly successful, or a
  scheduled probe passed within its configured freshness threshold;
- `failed`: the latest evidence reports failure;
- `cancelled`: the latest evidence was cancelled or deactivated;
- `running`: the latest evidence is queued or active;
- `stale`: a scheduled service or listing probe is older than its configured
  freshness threshold; event-driven delivery evidence does not become stale
  solely through inactivity; and
- `attention`: an aggregate surface is incomplete or internally inconsistent;
  inspect its aligned child rows; and
- `unknown`: there is no usable observation or the source did not expose a known
  conclusion; and
- `not-tracked`: this coordinate has no configured deployment surface, so the
  deployment signal is informationally inapplicable.

Only `passed` is healthy. A coordinate can have a passed build while its release
or package remains unknown. `not-tracked` applies only to the deployment signal;
it is excluded from the coordinate overall status rather than being treated as
a pass or an unknown failure.

Build evidence from a feature branch, pull-request ref, fork-associated check,
or unestablishable/conflicting branch is ignored. Retained legacy rows are not
deleted, but the dashboard excludes them from current, last-known-good, and
most-recent-failure build summaries. Release, package, and deployment signals
remain independent.

The metaserver card has independent `Listings` and `Rendezvous rooms` rows.
Listings require the three active static aliases to agree when bounded
generation or entry metadata is available. The historical root probe may still
have retained observations, but it is inactive and cannot affect current
listing health. Rendezvous remains `unknown` until an operator-safe aggregate
source exists; do not infer room health from a reachable WebSocket authority
and do not enumerate private rooms or server IDs.

## Reconcile missed events

1. Check the Pages Function logs for `status_read_failed` or webhook errors.
2. In GitHub, inspect the repository webhook delivery history and compare the
   delivery ID with `github_deliveries`.
3. Redeliver the original GitHub delivery from GitHub's UI/API. The original
   body and signature are preserved by GitHub; do not hand-edit the payload.
4. Query the production D1 row count and the resulting observation timestamps.
5. If an event is unavailable, link the missing source in the incident record
   and leave the dashboard `unknown`; never fabricate a passed observation.

The only accepted write paths are the signed webhook and the scheduled probe
Worker. Do not expose D1 credentials to a browser or add a direct SQL repair
endpoint.

## Inspect without mutation

Use Cloudflare's read-only D1 query tooling or dashboard query view to inspect:

```sql
SELECT delivery_id, event_name, received_at, outcome
FROM github_deliveries
ORDER BY received_at DESC
LIMIT 20;

SELECT coordinate_id, kind, status, observed_at, source_url
FROM coordinate_observations
ORDER BY observed_at DESC
LIMIT 50;

SELECT probe_id, format, status, observed_at, generation, entry_count, parity_key
FROM service_observations
ORDER BY observed_at DESC
LIMIT 50;
```

Keep query output out of public issues when it contains private URLs or
operator-specific data.

## D1 migrations

Back up or export the intended database according to the account's retention
policy before a stateful migration. Apply the migration in preview first and
run the validation and smoke checks there. A merge to `main` enters the
protected `production` environment, where the release workflow applies the
exact reviewed pending migrations to the production D1 binding before it
publishes Pages or the probe Worker. The workflow records the revision and
migration list in its job summary. Never use `DROP`, `DELETE`, or an in-place
schema rewrite as an implicit deploy step.

After deployment, require both `GET /api/healthz` and the data-backed
`GET /api/status` to return a valid schema-version-1 response. A healthy
`/api/healthz` response does not prove that D1 is readable; a 503 or malformed
status response fails the release.

## Rollback

Roll back the Pages deployment or probe Worker version independently of D1.
Retained observations are historical evidence; a code rollback must not delete
them. If a migration has already applied, do not attempt to reverse it through
Git history or an ad-hoc SQL change. Stop ingestion if necessary, preserve the
database, and prepare a forward-compatible migration with maintainer approval.
