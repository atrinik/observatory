# Contributing to Atrinik Observatory

Thank you for helping improve the delivery view. Keep changes small, explicit,
and reviewable. Observatory is a read-only surface: a UI change must not add a
workflow rerun, cancellation, release, deployment, or package mutation path.

## Before opening a pull request

Use Node 24.18.1 and npm 11.16.0 from `.nvmrc` and `package.json`:

```sh
npm ci
npm run check
npm run build
npm run deploy:dry-run
```

Tests should exercise the pure normalizer or aggregator rather than requiring a
Cloudflare account. Do not use production D1 bindings for local development.

## Dependency updates

Use compatible dependency ranges in `package.json` and commit the standard
`package-lock.json` to retain reproducible installs. Dependency updates should
update that lockfile through npm.

Install scripts are approved by package name in `allowScripts`: `esbuild` and
`workerd` are allowed, while `fsevents` is denied. Keep
`strict-allow-scripts=true` so newly introduced script-bearing packages require
review. Upgrading an approved package does not require a separate version entry.

## Data and security rules

- Keep D1 migrations explicit and additive. Destructive changes require a
  separately reviewed migration and a documented recovery plan.
- Preserve raw GitHub delivery IDs and event timestamps. Do not overwrite a
  newer observation with an older replay.
- Do not log webhook payloads, signature values, credentials, private URLs, or
  large response bodies.
- Keep Cloudflare identifiers and secrets in provider configuration or secret
  bindings. Placeholders in checked-in config must remain visibly inert.
- Link to GitHub for detail rather than copying logs, artifacts, or private data.

## Style

Use conventional commit subjects such as `feat(api): retain release evidence`.
Run Prettier through the repository scripts. Update operator documentation when
an endpoint, migration, binding, or recovery procedure changes.
