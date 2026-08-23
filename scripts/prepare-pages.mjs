import { writeFile } from "node:fs/promises";

const routes = {
  version: 1,
  include: ["/api/*"],
  exclude: [],
};

await writeFile("dist/_routes.json", `${JSON.stringify(routes, null, 2)}\n`);
console.log("Pages routes: Functions limited to /api/*");
