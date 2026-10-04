import { readFile } from "node:fs/promises";

const requiredFiles = [
  "wrangler.jsonc",
  "wrangler.probes.jsonc",
  "wrangler.probes.production.jsonc",
  ".github/workflows/deploy.yml",
  "deployment/cloudflare-pages.json",
  "deployment/cloudflare-probes.json",
  "migrations/0001_initial.sql",
  "migrations/0003_deployment_applicability.sql",
  "migrations/0005_retire_root_listing_probe.sql",
  "migrations/0006_rendezvous_health_observations.sql",
  "migrations/0007_rendezvous_health_fallback_contract.sql",
  "public/_routes.json",
  "scripts/verify-production.mjs",
];

for (const file of requiredFiles) {
  await readFile(file, "utf8");
}

const pagesConfig = await readFile("deployment/cloudflare-pages.json", "utf8");
const probesConfig = await readFile("deployment/cloudflare-probes.json", "utf8");
const releaseWorkflow = await readFile(".github/workflows/deploy.yml", "utf8");
const pagesWrangler = await readFile("wrangler.jsonc", "utf8");
const probesWrangler = await readFile("wrangler.probes.jsonc", "utf8");
const productionProbesWrangler = await readFile(
  "wrangler.probes.production.jsonc",
  "utf8",
);
const migration = await readFile("migrations/0001_initial.sql", "utf8");
const applicabilityMigration = await readFile(
  "migrations/0003_deployment_applicability.sql",
  "utf8",
);
const listingRetirementMigration = await readFile(
  "migrations/0005_retire_root_listing_probe.sql",
  "utf8",
);
const rendezvousHealthMigration = await readFile(
  "migrations/0006_rendezvous_health_observations.sql",
  "utf8",
);
const rendezvousHealthFallbackMigration = await readFile(
  "migrations/0007_rendezvous_health_fallback_contract.sql",
  "utf8",
);
const routes = await readFile("dist/_routes.json", "utf8");
const pagesContract = JSON.parse(pagesConfig);
const probesContract = JSON.parse(probesConfig);
const packageManifest = JSON.parse(await readFile("package.json", "utf8"));

const forbidden = ["CLOUDFLARE_API_TOKEN", "GITHUB_WEBHOOK_SECRET=", "Bearer "];
for (const [name, content] of Object.entries({
  pagesConfig,
  probesConfig,
  pagesWrangler,
  probesWrangler,
  productionProbesWrangler,
})) {
  for (const marker of forbidden) {
    if (content.includes(marker)) {
      throw new Error(`${name} contains a credential-like marker: ${marker}`);
    }
  }
}

for (const marker of [
  "CREATE TABLE IF NOT EXISTS component_coordinates",
  "github_deliveries",
  "service_observations",
]) {
  if (!migration.includes(marker)) throw new Error(`migration is missing ${marker}`);
}
for (const marker of [
  "RENAME TO rendezvous_health_observations_0006",
  "source_invalid_headers",
  "source_invalid_payload",
  "reason IN ('no_observation', 'malformed_observation')",
  "INSERT INTO rendezvous_health_observations",
]) {
  if (!rendezvousHealthFallbackMigration.includes(marker)) {
    throw new Error(`rendezvous health fallback migration is missing ${marker}`);
  }
}
for (const marker of [
  "deployment_applicable",
  "default:resources",
  "classic:resources",
]) {
  if (!applicabilityMigration.includes(marker)) {
    throw new Error(`deployment applicability migration is missing ${marker}`);
  }
}
for (const marker of ["ADD COLUMN active", "metaserver:listings:root", "active = 0"]) {
  if (!listingRetirementMigration.includes(marker)) {
    throw new Error(`listing retirement migration is missing ${marker}`);
  }
}
for (const marker of [
  "CREATE TABLE IF NOT EXISTS rendezvous_health_observations",
  "recent_authenticated_admissions",
  "session_authorization_failed",
  "canary_authenticated_control",
]) {
  if (!rendezvousHealthMigration.includes(marker)) {
    throw new Error(`rendezvous health migration is missing ${marker}`);
  }
}
if (
  /^\s*(server_id|room_id|connection_id|ticket|candidate|credential|source_address)\b/im.test(
    rendezvousHealthMigration,
  )
) {
  throw new Error("rendezvous health migration contains a private identifier column");
}

if (!pagesConfig.includes('"noManualDashboardDeployment": true')) {
  throw new Error("Pages contract must reject manual-only deployment");
}
if (
  !probesConfig.includes('"previewConfig": "wrangler.probes.jsonc"') ||
  !probesConfig.includes('"productionConfig": "wrangler.probes.production.jsonc"')
) {
  throw new Error("probe contract must separate preview and production configs");
}
if (
  probesContract.workersBuilds?.nonProductionBranches !== false ||
  probesContract.workersBuilds?.productionBranch !== false ||
  probesContract.workersBuilds?.deploymentOwner !== "github-actions"
) {
  throw new Error("probe Worker deployments must be owned by protected GitHub Actions");
}
for (const marker of [
  '"name": "atrinik-observatory-probes-preview"',
  '"database_name": "atrinik-observatory-preview"',
  '"OBSERVATORY_ENV": "preview"',
  '"workers_dev": true',
]) {
  if (!probesWrangler.includes(marker)) {
    throw new Error(`preview probe config is missing required contract: ${marker}`);
  }
}
for (const marker of [
  '"services"',
  '"secrets"',
  '"RENDEZVOUS_HEALTH"',
  '"atrinik-metaserver-review-canary"',
  '"RENDEZVOUS_HEALTH_EXPORT_TOKEN"',
]) {
  if (probesWrangler.includes(marker)) {
    throw new Error(
      `preview probe config must not require private rendezvous input: ${marker}`,
    );
  }
}
if (
  probesWrangler.includes('"name": "atrinik-observatory-probes",') ||
  probesWrangler.includes('"database_name": "atrinik-observatory",') ||
  probesWrangler.includes('"OBSERVATORY_ENV": "production"') ||
  probesWrangler.includes('"env": {') ||
  probesWrangler.includes('"service": "atrinik-metaserver"')
) {
  throw new Error("preview probe config must not contain a production environment");
}
for (const marker of [
  '"name": "atrinik-observatory-probes"',
  '"database_name": "atrinik-observatory"',
  '"OBSERVATORY_ENV": "production"',
  '"workers_dev": false',
  '"binding": "RENDEZVOUS_HEALTH"',
  '"service": "atrinik-metaserver"',
  '"entrypoint": "RendezvousHealth"',
  '"required": ["RENDEZVOUS_HEALTH_EXPORT_TOKEN"]',
]) {
  if (!productionProbesWrangler.includes(marker)) {
    throw new Error(`production probe config is missing required contract: ${marker}`);
  }
}
if (
  productionProbesWrangler.includes('"database_name": "atrinik-observatory-preview"')
) {
  throw new Error("production probe config must not use the preview database");
}
if (
  productionProbesWrangler.includes('"service": "atrinik-metaserver-review-canary"')
) {
  throw new Error("production probe config must not use the review-canary service");
}
if (
  probesContract.rendezvousHealth?.binding !== "RENDEZVOUS_HEALTH" ||
  probesContract.rendezvousHealth?.entrypoint !== "RendezvousHealth" ||
  probesContract.rendezvousHealth?.url !==
    "https://internal.atrinik.invalid/v1/rendezvous-health" ||
  probesContract.rendezvousHealth?.productionService !== "atrinik-metaserver" ||
  probesContract.rendezvousHealth?.requiredSecret !==
    "RENDEZVOUS_HEALTH_EXPORT_TOKEN" ||
  probesContract.rendezvousHealth?.transport !== "private named Service Binding"
) {
  throw new Error("probe contract must pin the private rendezvous health binding");
}
if (Object.hasOwn(probesContract.rendezvousHealth ?? {}, "previewService")) {
  throw new Error("probe contract must not configure a preview rendezvous service");
}
if (
  !packageManifest.scripts["deploy:dry-run"].includes("-c wrangler.probes.jsonc") ||
  !packageManifest.scripts["deploy:dry-run"].includes(
    "-c wrangler.probes.production.jsonc",
  ) ||
  packageManifest.scripts["deploy:dry-run"].includes("--env production") ||
  !packageManifest.scripts["deploy:probes"].includes(
    "-c wrangler.probes.production.jsonc",
  )
) {
  throw new Error("probe deployment scripts must select the safe config explicitly");
}
if (pagesContract.preview.database === pagesContract.production.database) {
  throw new Error("preview and production Pages databases must be separate");
}
if (
  pagesContract.production.source !== "github-actions" ||
  pagesContract.production.workflow !== ".github/workflows/deploy.yml" ||
  pagesContract.production.environment !== "production"
) {
  throw new Error(
    "Pages production deployment must use the protected Actions workflow",
  );
}
if (
  !pagesContract.production.postDeploySmokePaths.includes("/api/healthz") ||
  !pagesContract.production.postDeploySmokePaths.includes("/api/status")
) {
  throw new Error("Pages production contract must require both API smoke paths");
}
for (const marker of [
  "on:\n  push:\n    branches: [main]",
  "permissions:\n  contents: read",
  "environment:\n      name: production",
  "CLOUDFLARE_D1_API_TOKEN",
  "CLOUDFLARE_DEPLOY_API_TOKEN",
  "npm run db:migrate:production",
  "npm run deploy:pages",
  "npm run deploy:probes",
  "npm run verify:production",
  "npx wrangler d1 migrations list atrinik-observatory --remote",
]) {
  if (!releaseWorkflow.includes(marker)) {
    throw new Error(`production workflow is missing required contract: ${marker}`);
  }
}
if (releaseWorkflow.includes("pull_request:")) {
  throw new Error("production credentials must not be reachable from pull requests");
}
const migrationStep = releaseWorkflow.indexOf("npm run db:migrate:production");
const pagesStep = releaseWorkflow.indexOf("npm run deploy:pages");
const probesStep = releaseWorkflow.indexOf("npm run deploy:probes");
const smokeStep = releaseWorkflow.indexOf("npm run verify:production");
if (!(migrationStep < pagesStep && pagesStep < probesStep && probesStep < smokeStep)) {
  throw new Error(
    "production workflow must migrate before deployment and smoke verification",
  );
}
const validationWorkflow = await readFile(".github/workflows/validate.yml", "utf8");
if (
  validationWorkflow.includes("CLOUDFLARE_D1_API_TOKEN") ||
  validationWorkflow.includes("CLOUDFLARE_DEPLOY_API_TOKEN")
) {
  throw new Error("pull-request validation must not reference production credentials");
}
if (!routes.includes('"/api/*"') || routes.includes('"/*"')) {
  throw new Error("Pages routes must invoke Functions only for /api/*");
}

console.log(
  "deployment contract: valid placeholders, bindings, routes, and migration present",
);
