# Cloudflare deployment contract

Observatory has one Pages project for the static UI and Pages Functions, plus a
small scheduled production Worker for public-service probes. Preview and
production use different D1 databases; only the protected production probe
uses a private metaserver binding and secret.

The checked-in files are the reviewable source of truth:

- [`wrangler.jsonc`](../wrangler.jsonc) configures Pages, Functions, D1, and
  environment variables;
- [`wrangler.probes.jsonc`](../wrangler.probes.jsonc) is the safe
  preview/local probe configuration;
- [`wrangler.probes.production.jsonc`](../wrangler.probes.production.jsonc) is
  selected only by the protected production release; and
- [`deployment/cloudflare-pages.json`](../deployment/cloudflare-pages.json) and
  [`deployment/cloudflare-probes.json`](../deployment/cloudflare-probes.json)
  record the provider contract.

The zero UUIDs in the Wrangler files are inert placeholders. Replace them only
with the IDs returned by the intended Cloudflare account. Never replace them
with a token or commit a secret. Production deployment is owned by the
protected [GitHub Actions workflow](../.github/workflows/deploy.yml); a merge
must not trigger an independent provider deployment before that workflow has
applied the reviewed migrations.

Workers Builds are disabled for both branches of the probe Worker. The
`workersBuilds` section of the probe contract records that policy; the
production release workflow is the only deployment owner.

## Provisioning

Create two D1 databases in the intended account:

```sh
npx wrangler d1 create atrinik-observatory-preview
npx wrangler d1 create atrinik-observatory
```

Record the two database IDs in the Pages `env.preview` and `env.production`
bindings, the safe probe preview config, and the protected probe production
config. Apply the migration explicitly to each database before enabling
ingestion:

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
non-applicable. The forward migration
`0004_metaserver_surfaces.sql` adds the independent listing metadata columns,
seeds the Classic listing rows, and records the rendezvous surface as a
private health contract entry. The forward migration
`0005_retire_root_listing_probe.sql` adds the active flag and retires the
historical directory-root row without deleting its retained observations. Apply
`0006_rendezvous_health_observations.sql` after those migrations and before
deploying the updated Pages Function or scheduled probe Worker;
they are forward-only and do not rewrite retained observations.

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

The checked-in `wrangler.probes.jsonc` is a safe preview/local dry-run
configuration. It uses the preview D1 binding, probes only public services, and
contains no service binding or secret requirement. It is not deployed by
Workers Builds and does not consume a review canary. If it is run explicitly,
the missing private source is recorded as `unknown` rather than treated as a
passing rendezvous signal.

The dedicated `wrangler.probes.production.jsonc` names
`atrinik-observatory-probes` and is selected only by the protected release
workflow after the migration gate. The production Worker probes the website
and three active static listing aliases, then consumes rendezvous health
through the private `RendezvousHealth` named Service Binding to
`atrinik-metaserver`. Only this config requires the separately provisioned
`RENDEZVOUS_HEALTH_EXPORT_TOKEN` secret. The token is sent only to the exact
internal contract URL and never reaches Pages, D1 raw payload storage, browser
code, or logs. The public rendezvous route remains unprobed because it requires
a server-specific identifier and is not an aggregate health contract.

Provision the production probe Worker secret independently; Wrangler prompts
for the value, so do not place it in a command, file, or transcript:

```sh
npx wrangler secret put RENDEZVOUS_HEALTH_EXPORT_TOKEN -c wrangler.probes.production.jsonc
```

The production cron is `*/5 * * * *`, and its deploy is part of the protected
GitHub Actions release after the production D1 migration succeeds. Do not
connect Workers Builds to the probe Worker or allow a provider dashboard to
publish it independently of that release gate.

## GitHub connection and previews

Use the Cloudflare Git integration for the Pages project only. It must publish
a Pages preview for each pull request and surface the preview URL in the pull
request deployment/check status. Its preview binding is
`atrinik-observatory-preview`; it must not receive the production database or
webhook secret. The probe Worker has no pull-request deployment. The production
branch is deployed only by `.github/workflows/deploy.yml` after the protected
migration step.

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

The post-deploy smoke check must also confirm that a signed completion or
failure from a feature branch, pull-request ref, fork-associated check, or
ambiguous build payload leaves the affected coordinate's public build summary
unchanged. Compare the status document before and after the bounded test event;
the delivery receipt may be recorded as ignored, but no non-main row may change
`latest`, `lastKnownGood`, or `mostRecentFailure`. Use preview fixtures or an
operator-controlled signed redelivery for this check and never publish a
webhook secret or fabricate a production observation.

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
