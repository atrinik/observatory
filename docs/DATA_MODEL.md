# Observatory data model

Observatory stores facts in append-only tables and derives the dashboard at
read time. A later event does not update or delete an earlier record. This keeps
failure history available while allowing a newer successful observation to be
the current state.

## Coordinates

`component_coordinates` is the normalized projection of the Atrinik wrapper
manifest. A coordinate is `(repository, component, stack)`, with a stable ID
such as `default:server` or `classic:content`. Shared physical repositories can
therefore appear in both views without pretending that the stacks are the same.

The initial migration seeds the current default and Classic allowlist. Adding a
repository or changing a stack is an explicit migration review, not a value
inferred from an arbitrary webhook.

Each coordinate also declares `deploymentApplicable`. When it is `true`, a
missing deployment observation remains `unknown` and contributes to the overall
status. When it is `false`, the deployment signal is rendered as `not-tracked`
and is excluded from the overall status. The applicability values are seeded by
the forward D1 migration, so shared coordinates such as `default:resources` and
`classic:resources` have the same explicit behavior.

## GitHub deliveries

`github_deliveries` records:

- GitHub's `X-GitHub-Delivery` ID;
- the event name;
- a SHA-256 digest of the exact request body;
- the receipt timestamp; and
- whether the delivery was accepted or ignored because no configured coordinate
  matched.

The delivery ID is unique. `INSERT OR IGNORE` makes a replay a no-op, including
when the first request already inserted observations. HMAC verification happens
before JSON parsing or database work.

## Coordinate observations

`coordinate_observations` has one row per coordinate and normalized evidence
kind:

- `build`: workflow runs, workflow jobs, and check runs;
- `release`: GitHub release lifecycle evidence;
- `package`: release assets and archive URLs;
- `deployment`: GitHub deployment status.

Deployment observations are only evaluated for coordinates whose
`deploymentApplicable` value is `true`. A non-applicable deployment signal is
not synthesized as a successful observation and is not allowed to turn a
coordinate green by itself.

Every row retains the event timestamp, receipt timestamp, ref, commit SHA,
human-readable title, and direct source links. The read path orders by event
timestamp first and receipt timestamp second. An older out-of-order delivery is
therefore retained as history but cannot replace a newer observation.

Build rows are eligible for the dashboard only when `ref` is exactly `main` or
`refs/heads/main`. New build events are filtered during normalization and the
D1 persistence boundary; the aggregate repeats the check for already-retained
rows. This bounded read-time repair preserves append-only history while keeping
feature-branch, pull-request, fork, missing-ref, and ambiguous-ref rows out of
`latest`, `lastKnownGood`, and `mostRecentFailure`. Release, package, and
deployment rows remain independent of the build branch policy.

Build, release, and package evidence are intentionally independent. A passing
workflow is never used to synthesize a release or package row.

## Service probes and metaserver surfaces

`service_probes` is a small allowlist of public URLs. The scheduled probe Worker
records only status, status code, response time, observation time, and a bounded
error string in `service_observations`. The Classic metaserver currently has
three active listing probes for `/index.html`, `/index.json`, and `/index.xml`.
Migration `0005_retire_root_listing_probe.sql` marks the historical `/` probe
inactive without deleting its row or observations. A successful listing
response may also contribute a bounded, normalized generation and entry count;
the body is never stored.

The API aggregates those three active rows into a `surfaces.listings` payload.
Each required format remains visible, and missing, failed, stale, or
cross-format generation / summary skew cannot be hidden by another healthy
format. Retained observations for inactive probes do not participate in the
current aggregate. `crossFormatSkew` is only asserted when at least two
bounded parity keys are available.

Rendezvous is a separate `surfaces.rendezvous` payload. The scheduled probe
Worker calls the versioned `RendezvousHealth` entrypoint through a private named
Service Binding and sends the required token only in that request. The exact
URL, binding, and response contract are documented by the metaserver-worker
handoff. A successful response is validated against the exact key set, bounded
counter limits, five-minute window, freshness claim, canary dimensions, and
derived status before any field is persisted.

Migrations `0006_rendezvous_health_observations.sql` and
`0007_rendezvous_health_fallback_contract.sql` store append-only normalized
observations. The forward compatibility migration preserves the existing rows
while allowing the versioned `malformed_observation` empty result and distinct
`source_invalid_headers` / `source_invalid_payload` diagnostics. The table
contains only timestamps, the bounded authenticated-admission counter, the eight
bounded session outcome counters, canary dimensions, a versioned source
status/reason, and fixed source error codes. Raw responses and credentials are
never stored. Missing, unauthorized, unavailable, oversized, malformed, or
internally inconsistent source data becomes a safe `unknown` projection; it
never becomes a pass. A fresh positive authenticated admission, completed
session, or passing end-to-end canary becomes `passed`; an explicit canary
failure becomes `failed`; an observation older than 300 seconds becomes
`stale`.

The surface exposes source freshness and age, route/control/admission signals,
recent aggregate admission and session evidence, and a contract link. The
aggregate is not an active-room count. Observatory never enumerates rooms,
server IDs, connection IDs, candidates, source addresses, credentials, or
tokens, and it must not infer a room count from listings, `server_presence`, or
any other unrelated table. The surface is not silently treated as
`not-tracked` and cannot be hidden by healthy listings.

The API marks a scheduled service or listing probe `stale` after its
probe-specific threshold. Event-driven coordinate evidence keeps its latest
explicit status and exposes its observation age instead of expiring solely
because time passed. No row means `unknown`; a failed HTTP response is
`failed`; a partial or skewed listing set is `attention`. Neither condition is
rendered as healthy. The public status document keeps
`services[...].surfaces.listings` and
`services[...].surfaces.rendezvous` independent so SSR and client refresh share
the same semantics.

## API document

`contracts/status.schema.json` describes the public `GET /api/status` document.
Each evidence summary contains:

- `latest`, the newest observation;
- `lastKnownGood`, the newest passing observation, if any; and
- `mostRecentFailure`, the newest failed or cancelled observation, if any.

Links point back to GitHub. Large logs and artifacts never enter D1.
