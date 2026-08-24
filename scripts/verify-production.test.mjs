import { describe, expect, it } from "vitest";
import {
  validateHealthPayload,
  validateStatusPayload,
  verifyProduction,
} from "./verify-production.mjs";

const healthyStatus = {
  schemaVersion: 1,
  generatedAt: "2026-08-24T06:00:00.000Z",
  staleAfterSeconds: 21600,
  coordinates: [],
  services: [],
  summary: { total: 0, healthy: 0, attention: 0, stale: 0, unknown: 0 },
};

const healthyHealth = {
  service: "atrinik-observatory-api",
  schemaVersion: 1,
  readOnlyDashboard: true,
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("production smoke validation", () => {
  it("requires the API health contract", () => {
    expect(validateHealthPayload(healthyHealth)).toEqual(healthyHealth);
    expect(() => validateHealthPayload({ ...healthyHealth, schemaVersion: 2 })).toThrow(
      "unsupported schema version",
    );
  });

  it("requires a complete data-backed status document", () => {
    expect(validateStatusPayload(healthyStatus)).toEqual(healthyStatus);
    expect(() =>
      validateStatusPayload({
        ...healthyStatus,
        summary: { ...healthyStatus.summary, total: 1 },
      }),
    ).toThrow("does not match coordinates");
  });

  it("fails when status cannot read D1 even if health is healthy", async () => {
    const fetchImpl = async (url) =>
      url.pathname.endsWith("/healthz")
        ? response(healthyHealth)
        : response({ error: "Observatory status is temporarily unavailable." }, 503);

    await expect(
      verifyProduction("https://observatory.example", fetchImpl),
    ).rejects.toThrow("/api/status returned HTTP 503");
  });

  it("rejects a successful HTTP response with an error-shaped status body", async () => {
    const fetchImpl = async (url) =>
      url.pathname.endsWith("/healthz")
        ? response(healthyHealth)
        : response({ error: "missing schema" });

    await expect(
      verifyProduction("https://observatory.example", fetchImpl),
    ).rejects.toThrow("unsupported schema version");
  });

  it("requires an HTTPS URL without credentials or selectors", async () => {
    await expect(verifyProduction("http://observatory.example")).rejects.toThrow(
      "must use HTTPS",
    );
    await expect(
      verifyProduction("https://user:pass@observatory.example"),
    ).rejects.toThrow("must not contain credentials");
    await expect(
      verifyProduction("https://observatory.example?debug=1"),
    ).rejects.toThrow("must not contain a query or fragment");
  });
});
