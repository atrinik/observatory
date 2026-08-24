import { readFile } from "node:fs/promises";

const requiredFiles = [
  "wrangler.jsonc",
  "wrangler.probes.jsonc",
  "deployment/cloudflare-pages.json",
  "deployment/cloudflare-probes.json",
  "migrations/0001_initial.sql",
  "migrations/0003_deployment_applicability.sql",
  "public/_routes.json",
];

for (const file of requiredFiles) {
  await readFile(file, "utf8");
}

const pagesConfig = await readFile("deployment/cloudflare-pages.json", "utf8");
const probesConfig = await readFile("deployment/cloudflare-probes.json", "utf8");
const pagesWrangler = await readFile("wrangler.jsonc", "utf8");
const probesWrangler = await readFile("wrangler.probes.jsonc", "utf8");
const migration = await readFile("migrations/0001_initial.sql", "utf8");
const applicabilityMigration = await readFile(
  "migrations/0003_deployment_applicability.sql",
  "utf8",
);
const routes = await readFile("dist/_routes.json", "utf8");

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
if (!routes.includes('"/api/*"') || routes.includes('"/*"')) {
  throw new Error("Pages routes must invoke Functions only for /api/*");
}

console.log(
  "deployment contract: valid placeholders, bindings, routes, and migration present",
);
