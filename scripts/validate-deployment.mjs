import { readFile } from "node:fs/promises";

const requiredFiles = [
  "wrangler.jsonc",
  "wrangler.probes.jsonc",
  ".github/workflows/deploy.yml",
  "deployment/cloudflare-pages.json",
  "deployment/cloudflare-probes.json",
  "migrations/0001_initial.sql",
  "migrations/0003_deployment_applicability.sql",
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
const migration = await readFile("migrations/0001_initial.sql", "utf8");
const applicabilityMigration = await readFile(
  "migrations/0003_deployment_applicability.sql",
  "utf8",
);
const routes = await readFile("dist/_routes.json", "utf8");
const pagesContract = JSON.parse(pagesConfig);

const forbidden = ["CLOUDFLARE_API_TOKEN", "GITHUB_WEBHOOK_SECRET=", "Bearer "];
for (const [name, content] of Object.entries({
  pagesConfig,
  probesConfig,
  pagesWrangler,
  probesWrangler,
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
  "deployment_applicable",
  "default:resources",
  "classic:resources",
]) {
  if (!applicabilityMigration.includes(marker)) {
    throw new Error(`deployment applicability migration is missing ${marker}`);
  }
}

if (!pagesConfig.includes('"noManualDashboardDeployment": true')) {
  throw new Error("Pages contract must reject manual-only deployment");
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
