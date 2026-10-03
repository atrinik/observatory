# Observatory repository guide

## Scope

This repository owns the read-only Observatory dashboard, its Pages Functions,
D1 migrations, scheduled probe Worker, tests, and operator documentation. The
Atrinik wrapper owns checkout and profile registration in `atrinik/atrinik`;
change that repository only through a separately scoped wrapper delivery.

## Guardrails

- GitHub is authoritative for workflow logs, checks, releases, packages, and
  artifacts. Store normalized summaries and links, never large raw payloads.
- Missing observations are `unknown`; scheduled service and listing probe
  observations older than their configured thresholds are `stale`. Event-
  driven delivery evidence retains its latest explicit status and exposes age
  without expiring solely through inactivity. Neither `unknown` nor `stale`
  is healthy.
- Webhook ingestion verifies HMAC signatures, records delivery IDs, and appends
  records. Ordering is derived from event timestamps, so replays cannot make a
  newer state look old.
- The dashboard exposes no mutation controls. Keep ingestion and operator
  procedures separate from public UI actions.
- Never commit Cloudflare IDs that are not explicitly provisioned, tokens,
  secrets, private data, or `.dev.vars`.

## Validation

```sh
npm ci
npm run check
npm run build
npm run deploy:dry-run
```

CI compares fresh, complete npm audit reports for the event's exact baseline
and tested revision before repository lifecycle scripts run. Any new
advisory/affected-package pair or severity increase fails at every severity;
existing findings warn and fixes pass. Installation, audit, revision, or report
errors fail closed. Keep the gate dynamic: do not add advisory allowlists,
known-good version gates, dependency pins, or persisted audit snapshots. Run
its Node built-in fixtures with:

```sh
node --test test-node/audit-*.node.mjs
```

When changing a migration, also apply it to a local D1 database and test a
signed webhook fixture. When changing Cloudflare configuration, validate both
the Pages and probe Worker environments and update `docs/DEPLOYMENT.md`.
