# GitHub event contract

The production GitHub webhook subscribes only to evidence-bearing events:

| Event               | Evidence            | Status source                                                                     |
| ------------------- | ------------------- | --------------------------------------------------------------------------------- |
| `workflow_run`      | build               | workflow conclusion or active status                                              |
| `workflow_job`      | build               | job conclusion or active status                                                   |
| `check_run`         | build               | check conclusion or active status                                                 |
| `release`           | release and package | published/deleted action; package is passed only when an asset/archive URL exists |
| `deployment_status` | deployment          | deployment state                                                                  |

Unknown event names receive a durable delivery receipt with `ignored` outcome;
they do not create a healthy record. Unknown conclusions become `unknown`.

The webhook must send JSON and the following headers:

- `X-GitHub-Delivery`;
- `X-GitHub-Event`; and
- `X-Hub-Signature-256`.

The signature covers the exact request bytes. Verification uses Web Crypto HMAC
SHA-256 and the secret-only `GITHUB_WEBHOOK_SECRET` binding. Do not parse and
re-serialize the body before verifying it.

## Replays and ordering

GitHub delivery IDs are the idempotency key. A replay returns `duplicate: true`
without inserting rows. Out-of-order events are safe because observations are
append-only and aggregation sorts by `occurredAt`, then `receivedAt`.

If a delivery was missed, use GitHub's delivery redelivery facility or an
operator-owned, freshly signed replay. Do not forge a status row directly from a
browser or add an unauthenticated import endpoint.

## Minimum GitHub permissions

Use a repository-scoped GitHub App or webhook installation with read-only
access to Actions/workflows, Checks, Contents/metadata, Deployments, and
Releases as required by the selected event subscriptions. Do not grant write
access merely to observe evidence. Review the exact permission names against
GitHub's current App settings before installation.
