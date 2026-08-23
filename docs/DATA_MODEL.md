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

Every row retains the event timestamp, receipt timestamp, ref, commit SHA,
human-readable title, and direct source links. The read path orders by event
timestamp first and receipt timestamp second. An older out-of-order delivery is
therefore retained as history but cannot replace a newer observation.

Build, release, and package evidence are intentionally independent. A passing
workflow is never used to synthesize a release or package row.

## Service probes

`service_probes` is a small allowlist of public URLs. The scheduled probe Worker
records only status, status code, response time, observation time, and a bounded
error string in `service_observations`. It cancels the response body without
reading or retaining it.

The API marks a service `stale` after its probe-specific threshold. No row means
`unknown`; a failed HTTP response is `failed`. Neither condition is rendered as
healthy.

## API document

`contracts/status.schema.json` describes the public `GET /api/status` document.
Each evidence summary contains:

- `latest`, the newest observation;
- `lastKnownGood`, the newest passing observation, if any; and
- `mostRecentFailure`, the newest failed or cancelled observation, if any.

Links point back to GitHub. Large logs and artifacts never enter D1.
