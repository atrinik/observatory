# Cloudflare deployment contract

Observatory has one Pages project for the static UI and Pages Functions, plus a
small scheduled Worker for public-service probes. Both use D1, but preview and
production use different databases and secrets.

The checked-in files are the reviewable source of truth:

- [`wrangler.jsonc`](../wrangler.jsonc) configures Pages, Functions, D1, and
  environment variables;
- [`wrangler.probes.jsonc`](../wrangler.probes.jsonc) configures the scheduled
  probe Worker; and
- [`deployment/cloudflare-pages.json`](../deployment/cloudflare-pages.json) and
  [`deployment/cloudflare-probes.json`](../deployment/cloudflare-probes.json)
  record the provider contract.

The zero UUIDs in the Wrangler files are inert placeholders. Replace them only
with the IDs returned by the intended Cloudflare account. Never replace them
with a token or commit a secret.

## Provisioning

Create two D1 databases in the intended account:

```sh
npx wrangler d1 create atrinik-observatory-preview
npx wrangler d1 create atrinik-observatory
```

Record the two database IDs in the matching `env.preview` and
`env.production` bindings in both Wrangler files. Apply the migration explicitly
to each database before enabling ingestion:

```sh
npx wrangler d1 migrations apply atrinik-observatory-preview --remote -c wrangler.jsonc --env preview
npx wrangler d1 migrations apply atrinik-observatory --remote -c wrangler.jsonc --env production
```

Verify the coordinate and probe seed rows with a read-only query. A migration
must be reviewed and applied before a deployment that relies on new columns.

## Pages project

Connect `atrinik/observatory` to a Cloudflare Pages project named
`atrinik-observatory` using the Git integration:

- production branch: `main`;
- build command: `npm ci && npm run build`;
- output directory: `dist`;
- preview branches: all non-production branches;
- Functions: enabled from the repository `functions/` directory; and
- the preview D1 binding is used for every preview deployment.

The production binding is `atrinik-observatory`; the preview binding is
`atrinik-observatory-preview`. Do not attach the production database or webhook
secret to a preview environment. Cloudflare's provider-managed preview URL
must be the review URL; do not add a custom preview hostname.

Set the production-only secret through Cloudflare's secret binding mechanism:

```sh
npx wrangler pages secret put GITHUB_WEBHOOK_SECRET --project-name atrinik-observatory
```

Use a freshly generated value shared only with the GitHub webhook configuration.
Never put it in `vars`, GitHub comments, or a command transcript.

## Probe Worker

Connect the same repository to Workers Builds for
`atrinik-observatory-probes`, with `src/probe-worker.ts` as the entrypoint.
Production deploys use the `production` environment and database. Review builds
must use `preview` and must not run production service probes. The production
cron is `*/5 * * * *`; configure the same trigger from
`wrangler.probes.jsonc` rather than adding a dashboard-only schedule.

For a separately authenticated operator deploy, the commands are:

```sh
npx wrangler deploy -c wrangler.probes.jsonc --env preview
npx wrangler deploy -c wrangler.probes.jsonc --env production
```

Workers Builds or the repository's approved CI connection must own routine
deployments so a merge to `main` deploys without a manual dashboard action.

## GitHub connection and previews

Install the Cloudflare GitHub integration only for `atrinik/observatory`. It
must publish a Pages preview for each pull request and a production deployment
for `main`. The connected provider should surface the preview URL in the pull
request deployment/check status. The probe Worker uses an isolated preview
environment; it does not receive the production webhook secret or production
traffic.

Install an organization-level GitHub App/webhook scoped to the configured
Atrinik repository allowlist, or install one repository-scoped webhook on each
configured physical repository. Point every delivery at the production Pages
URL, use JSON payloads and the same randomly generated secret, and select only
the event subscriptions in [`EVENT_CONTRACT.md`](EVENT_CONTRACT.md). Keep
permissions read-only.

## Smoke checks and rollback

After a production Pages deployment, verify:

```sh
curl --fail --silent --show-error https://observatory.atrinik.org/api/healthz
curl --fail --silent --show-error https://observatory.atrinik.org/api/status
```

Record the exact Git revision, Pages deployment URL/ID, probe Worker version,
and D1 migration state. Confirm that a pull request URL uses preview D1 and that
the production API has the expected `schemaVersion`.

If the Pages response or API smoke check fails, promote the last verified Pages
deployment. If probes fail after a Worker change, roll the Worker back to the
last verified version. Do not roll back a D1 migration by editing history;
create a forward migration after assessing retained observations.

The initial repository change cannot create Cloudflare account resources or
GitHub connections without operator credentials. Provisioning and connection
are explicit handoff steps, not hidden side effects of validation.
