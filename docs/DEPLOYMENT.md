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
with a token or commit a secret. Production deployment is owned by the
protected [GitHub Actions workflow](../.github/workflows/deploy.yml); a merge
must not trigger an independent provider deployment before that workflow has
applied the reviewed migrations.

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
The forward migration `0002_update_metaserver_probe.sql` also aligns existing
`metaserver` rows with the attached Classic directory artifact before the probe
Worker is deployed. The forward migration
`0003_deployment_applicability.sql` adds the explicit per-coordinate deployment
capability and marks shared asset coordinates such as `resources` as
non-applicable.

## Pages project

Connect `atrinik/observatory` to a Cloudflare Pages project named
`atrinik-observatory`. Use the Git integration for previews only:

- production branch deployment: disabled in the provider integration;
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

The Pages Wrangler configuration is intentionally limited to Pages-supported
keys. Do not add the Worker-only `observability` or `secrets` configuration
blocks to `wrangler.jsonc`; Pages validates that file separately. Configure
the webhook secret with the Pages secret store command above.

## Probe Worker

Connect the same repository to Workers Builds for
`atrinik-observatory-probes`, with `src/probe-worker.ts` as the entrypoint.
Production deploys use the `production` environment and database. Review builds
must use `preview` and must not run production service probes. The production
cron is `*/5 * * * *`; configure the same trigger from
`wrangler.probes.jsonc` rather than adding a dashboard-only schedule.

For a separately authenticated preview deploy, the command is:

```sh
npx wrangler deploy -c wrangler.probes.jsonc --env preview
```

The production Worker deploy is part of the protected GitHub Actions release
after the production D1 migration succeeds. Do not connect Workers Builds or a
provider dashboard directly to the production branch, because that would allow
code to deploy before the migration gate.

## GitHub connection and previews

Install the Cloudflare GitHub integration only for `atrinik/observatory`'s
non-production branches. It must publish a Pages preview for each pull request
and surface the preview URL in the pull request deployment/check status. Its
preview binding is `atrinik-observatory-preview`; it must not receive the
production database or webhook secret. The production branch is deployed only
by `.github/workflows/deploy.yml` after the protected migration step. The probe
Worker uses an isolated preview environment and does not receive production
traffic.

Install an organization-level GitHub App/webhook scoped to the configured
Atrinik repository allowlist, or install one repository-scoped webhook on each
configured physical repository. Point every delivery at the production Pages
URL, use JSON payloads and the same randomly generated secret, and select only
the event subscriptions in [`EVENT_CONTRACT.md`](EVENT_CONTRACT.md). Keep
permissions read-only.

## Protected production environment

Create a GitHub Actions environment named `production` and require explicit
reviewer approval before a job can enter it. Restrict its deployment branch to
`main`. Configure only these environment-scoped values:

- variable `CLOUDFLARE_ACCOUNT_ID`;
- variable `OBSERVATORY_PRODUCTION_URL`, containing the HTTPS origin only;
- secret `CLOUDFLARE_D1_API_TOKEN`, with only the D1 migration permissions; and
- secret `CLOUDFLARE_DEPLOY_API_TOKEN`, with only the Pages and Worker deploy
  permissions.

The pull-request validation workflow has no reference to these values. The
release workflow uses the D1 token only for migrations and the deploy token
only for Pages and Worker publication. Do not store either token in repository
variables, `.dev.vars`, issues, logs, or provider configuration.

## Smoke checks and rollback

The release workflow applies pending production migrations before deploying
Pages or the probe Worker. It then verifies both endpoints; `/api/healthz`
alone is insufficient because it does not read D1:

```sh
curl --fail --silent --show-error https://observatory.atrinik.org/api/healthz
curl --fail --silent --show-error https://observatory.atrinik.org/api/status
```

The workflow records the exact Git revision, workflow run, and `wrangler d1
migrations list` result in its job summary. It fails closed when the production
binding is unavailable, a migration fails, either endpoint is non-2xx, or the
status response is not a schema-version-1 data-backed document. Confirm that a
pull request URL uses preview D1 and that the production API has the expected
`schemaVersion`.

If migration fails, no production deployment step runs. If the Pages response
or API smoke check fails, stop the release and promote the last verified Pages
deployment only after confirming it is compatible with the already-applied
schema. If probes fail after a Worker change, roll the Worker back to the last
verified version. Never roll back a D1 migration by editing history; preserve
the database and create a reviewed forward migration after assessing retained
observations.

Repository changes do not create Cloudflare account resources or GitHub
connections automatically. Provisioning and connection remain explicit,
authorized operator steps rather than hidden side effects of validation.
