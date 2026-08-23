import type { ObservatoryPagesFunction } from "../../src/pages";

export const onRequestGet: ObservatoryPagesFunction = async () =>
  Response.json({
    service: "atrinik-observatory-api",
    schemaVersion: 1,
    readOnlyDashboard: true,
  });
