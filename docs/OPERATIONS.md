# Operator runbook

## Read the dashboard

`GET /api/status` is a projection, not a replacement for GitHub. Use the direct
evidence link for the workflow log, failed job, check, release, asset, or
deployment. Interpret statuses as follows:

- `passed`: the latest evidence was explicitly successful and is fresh;
- `failed`: the latest evidence reports failure;
- `cancelled`: the latest evidence was cancelled or deactivated;
- `running`: the latest evidence is queued or active;
- `stale`: the latest evidence is older than its threshold; and
- `unknown`: there is no usable observation or the source did not expose a known
  conclusion.

Only the first status is healthy. A coordinate can have a passed build while
its release or package remains unknown.

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
```

Keep query output out of public issues when it contains private URLs or
operator-specific data.

## D1 migrations

Back up or export the intended database according to the account's retention
policy before a stateful migration. Apply the migration in preview first, run
the validation and smoke checks, then apply the exact reviewed file to
production. Never use `DROP`, `DELETE`, or an in-place schema rewrite as an
implicit deploy step.

## Rollback

Roll back the Pages deployment or probe Worker version independently of D1.
Retained observations are historical evidence; a code rollback must not delete
them. If a schema change is incompatible, stop ingestion, preserve the
database, and prepare a forward-compatible migration with maintainer approval.
