# Security policy

Please do not report a suspected webhook, API, deployment, or data-handling
vulnerability in a public issue. Contact the Atrinik maintainers privately
through the security channel documented by the organization.

The webhook endpoint accepts only deliveries with a valid GitHub
`X-Hub-Signature-256` HMAC. `GITHUB_WEBHOOK_SECRET` is a Cloudflare secret and
must never be placed in source, Wrangler `vars`, logs, screenshots, or issue
comments. A missing secret fails closed.

The public API is read-only. D1 records are append-only from the application
perspective, and delivery IDs make replayed webhooks idempotent. Service probes
discard response bodies and retain only status, timing, and a bounded error
message. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for reconciliation.
