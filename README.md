# Atrinik Observatory

Atrinik Observatory is the read-only dashboard for build, release, package,
deployment, and public-service evidence across Atrinik repositories. It keeps
the signals separate and links every detail back to the GitHub run, check,
release, asset, or deployment that produced it.

The first version is intentionally conservative: missing data is `unknown`,
event-driven delivery evidence keeps its latest explicit status while exposing
observation age, scheduled service and listing probes can become `stale`, and
coordinates without a configured deployment surface are `not-tracked`. A
successful build never implies that a release or package exists. Observatory
stores compact normalized summaries and delivery identifiers; GitHub remains
the authority for logs and large artifacts.

## Architecture

- Astro generates the static dashboard for Cloudflare Pages.
- Pages Functions expose `GET /api/status` and `GET /api/healthz`.
- `POST /api/github/webhook` verifies GitHub's `X-Hub-Signature-256` header and
  appends normalized workflow, check, release, package, and deployment evidence.
- D1 stores the component map, immutable delivery receipts, append-only
  observations, service-probe results, and normalized rendezvous health
  aggregates.
- `src/probe-worker.ts` is a small scheduled production Worker. Every five
  minutes it probes the configured public services without reading response
  bodies and consumes the authenticated, private `RendezvousHealth` Service
  Binding. The preview/local configuration has no private source and remains
  `unknown` for rendezvous. Only validated aggregate fields enter D1; the
  browser never receives the token or a room/server identifier.

The component and stack map follows the wrapper's `components.json` and
deliberately keeps shared repositories visible in both the replacement and
Classic views where they participate in both stacks. Deployment applicability is
an explicit Observatory property of each coordinate, because it cannot be
reliably inferred from the presence or absence of webhook events.

## Local development

The repository uses Node 24.18.1 and npm 11.16.0, matching the other Atrinik
web projects.

```sh
npm ci
npm run db:migrate:local
npm run check
npm run build
npm run pages:dev
```

`npm run pages:dev` serves the built Pages site and Functions locally. Wrangler
uses a local D1 database by default. Use a local `.dev.vars` file for
`GITHUB_WEBHOOK_SECRET` when testing a signed webhook; never commit that file.

Useful checks are:

```sh
npm run format:check
npm run typecheck
npm test
node --test test-node/audit-*.node.mjs
npm run deploy:dry-run
```

Pull requests and pushes to `main` compare complete npm audit reports for the
exact baseline and tested revision. Existing advisory/package findings emit a
warning, resolved findings pass, and any new finding or severity increase at
any severity fails validation. Each revision is installed from its committed
manifest and lockfile in a separate temporary directory with package scripts
disabled. A temporary lock is hydrated only to inventory installed bundled
dependencies, and validation rejects changes to locked inputs or incomplete
bundle records. Install failures, audit service failures, and malformed or
incomplete reports fail closed. The comparison uses advisory and affected
package identity without an allowlist, version gate, or persisted snapshot.

## API surface

| Method | Route                 | Purpose                                                                          |
| ------ | --------------------- | -------------------------------------------------------------------------------- |
| `GET`  | `/api/status`         | Full dashboard document. Pass `?stack=default` or `?stack=classic` to filter it. |
| `GET`  | `/api/healthz`        | Credential-free API process health.                                              |
| `POST` | `/api/github/webhook` | Authenticated ingestion for selected GitHub events.                              |

The dashboard has no endpoint for rerunning or cancelling workflows, publishing
releases, deploying applications, changing packages, or mutating GitHub data.
The webhook and scheduled probe Worker are ingestion paths, not user controls.
Rendezvous status is an operator-safe aggregate, not an active-room count or a
public room endpoint.

## Cloudflare setup

The checked-in Wrangler files are the source of truth for the Pages project,
the preview/production D1 bindings, and the scheduled probe Worker. They use
zero UUIDs as safe placeholders until the operator creates the two D1 databases.
No account ID, token, webhook secret, domain, or private data belongs in Git.

Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) to:

1. create separate preview and production D1 databases;
2. apply the explicit migration to each database;
3. connect `atrinik/observatory` to the `atrinik-observatory` Pages project with
   all non-production branches as previews;
4. deploy the production probe Worker from the protected GitHub Actions
   workflow with its private rendezvous health Service Binding and separately
   provisioned secret; and
5. install the least-privilege GitHub webhook and smoke-check the public routes.

The source contract is reviewable before any provider mutation:
[`deployment/cloudflare-pages.json`](deployment/cloudflare-pages.json) and
[`deployment/cloudflare-probes.json`](deployment/cloudflare-probes.json).

## Data model and operations

The normalized schema, ordering rules, and delivery contract are in
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md). The safe reconciliation and
rollback procedures are in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## License and provenance

This repository is MIT licensed. See [`PROVENANCE.md`](PROVENANCE.md) for the
authorship boundary and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for
runtime tooling notices. Observatory does not copy GitHub logs or artifacts into
the repository or D1.
