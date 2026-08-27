import { pathToFileURL } from "node:url";

const REQUIRED_CLASSIC_LISTING_FORMATS = ["html", "json", "xml"];
const REQUIRED_RENDEZVOUS_OUTCOMES = [
  "completed",
  "client_disconnected",
  "session_expired",
  "protocol_error",
  "server_unavailable",
  "server_replaced",
  "authorization_failed",
  "internal_error",
];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateHealthPayload(payload) {
  if (!isRecord(payload)) throw new Error("health response is not an object");
  if (payload.service !== "atrinik-observatory-api") {
    throw new Error("health response identifies the wrong service");
  }
  if (payload.schemaVersion !== 1) {
    throw new Error("health response has an unsupported schema version");
  }
  if (payload.readOnlyDashboard !== true) {
    throw new Error("health response is not the read-only dashboard");
  }
  return payload;
}

export function validateStatusPayload(payload) {
  if (!isRecord(payload)) throw new Error("status response is not an object");
  if (payload.schemaVersion !== 1) {
    throw new Error("status response has an unsupported schema version");
  }
  if (payload.generatedAt !== null && typeof payload.generatedAt !== "string") {
    throw new Error("status response has an invalid generatedAt value");
  }
  if (!Number.isInteger(payload.staleAfterSeconds) || payload.staleAfterSeconds < 1) {
    throw new Error("status response has an invalid staleAfterSeconds value");
  }
  if (!Array.isArray(payload.coordinates) || !Array.isArray(payload.services)) {
    throw new Error("status response is missing coordinate or service arrays");
  }
  if (!isRecord(payload.summary)) {
    throw new Error("status response is missing its summary");
  }
  for (const field of ["total", "healthy", "attention", "stale", "unknown"]) {
    if (!Number.isInteger(payload.summary[field]) || payload.summary[field] < 0) {
      throw new Error(`status response has an invalid summary.${field} value`);
    }
  }
  if (payload.summary.total !== payload.coordinates.length) {
    throw new Error("status summary total does not match coordinates");
  }
  return payload;
}

export function validateClassicListings(payload) {
  const metaserver = payload.services.find(
    (service) => isRecord(service) && service.id === "metaserver",
  );
  const listings = metaserver?.surfaces?.listings;
  if (!isRecord(listings)) {
    throw new Error("status response is missing the Classic listings surface");
  }
  if (
    JSON.stringify(listings.requiredFormats) !==
    JSON.stringify(REQUIRED_CLASSIC_LISTING_FORMATS)
  ) {
    throw new Error(
      "status response has an unexpected Classic listing format contract",
    );
  }
  if (listings.availableFormats !== REQUIRED_CLASSIC_LISTING_FORMATS.length) {
    throw new Error("status response does not report all Classic listing formats");
  }
  if (listings.status !== "passed") {
    throw new Error("status response reports unhealthy Classic listings");
  }
  return listings;
}

export function validateClassicRendezvous(payload) {
  const metaserver = payload.services.find(
    (service) => isRecord(service) && service.id === "metaserver",
  );
  const rendezvous = metaserver?.surfaces?.rendezvous;
  if (!isRecord(rendezvous)) {
    throw new Error("status response is missing the rendezvous surface");
  }
  if (rendezvous.id !== "rendezvous" || rendezvous.name !== "Rendezvous rooms") {
    throw new Error("status response has an unexpected rendezvous identity");
  }
  if (
    !["passed", "failed", "unknown", "stale"].includes(rendezvous.status) ||
    typeof rendezvous.stale !== "boolean" ||
    (rendezvous.observedAt !== null && typeof rendezvous.observedAt !== "string") ||
    (rendezvous.ageSeconds !== null &&
      (!Number.isInteger(rendezvous.ageSeconds) || rendezvous.ageSeconds < 0))
  ) {
    throw new Error("status response has invalid rendezvous status metadata");
  }
  const freshness = rendezvous.freshness;
  if (
    !isRecord(freshness) ||
    !["fresh", "stale", "no_observation"].includes(freshness.state) ||
    freshness.maximumAgeSeconds !== 300 ||
    (freshness.ageSeconds !== null &&
      (!Number.isInteger(freshness.ageSeconds) || freshness.ageSeconds < 0))
  ) {
    throw new Error("status response has invalid rendezvous freshness");
  }
  if (
    !["unknown", "passed", "failed", "stale"].includes(rendezvous.routeStatus) ||
    !["unknown", "passed", "failed", "stale"].includes(rendezvous.controlsStatus) ||
    !["unknown", "passed", "failed", "stale"].includes(rendezvous.admissionStatus)
  ) {
    throw new Error("status response has invalid rendezvous signal status");
  }
  if (
    typeof rendezvous.safeObservationAvailable !== "boolean" ||
    (rendezvous.safeObservationAvailable &&
      rendezvous.observationSource !== "private-service-binding") ||
    (!rendezvous.safeObservationAvailable && rendezvous.observationSource !== null)
  ) {
    throw new Error("status response has an unsafe rendezvous observation source");
  }
  if (
    !Number.isInteger(rendezvous.recentAuthenticatedAdmissions) ||
    rendezvous.recentAuthenticatedAdmissions < 0 ||
    rendezvous.recentAuthenticatedAdmissions > 1000000
  ) {
    throw new Error("status response has invalid rendezvous admission evidence");
  }
  const sessions = rendezvous.recentSessions;
  if (
    !isRecord(sessions) ||
    !Number.isInteger(sessions.total) ||
    sessions.total < 0 ||
    sessions.total > 8000000 ||
    !isRecord(sessions.outcomes) ||
    Object.keys(sessions.outcomes).length !== REQUIRED_RENDEZVOUS_OUTCOMES.length ||
    REQUIRED_RENDEZVOUS_OUTCOMES.some(
      (outcome) =>
        !Number.isInteger(sessions.outcomes[outcome]) ||
        sessions.outcomes[outcome] < 0 ||
        sessions.outcomes[outcome] > 1000000,
    ) ||
    REQUIRED_RENDEZVOUS_OUTCOMES.some((outcome) => !(outcome in sessions.outcomes)) ||
    sessions.total !==
      REQUIRED_RENDEZVOUS_OUTCOMES.reduce(
        (total, outcome) => total + sessions.outcomes[outcome],
        0,
      )
  ) {
    throw new Error("status response has invalid rendezvous session evidence");
  }
  const canary = rendezvous.canary;
  if (
    !isRecord(canary) ||
    !["none", "route", "end_to_end"].includes(canary.type) ||
    !["not_observed", "reachable", "failed"].includes(canary.route) ||
    !["not_observed", "passed", "failed"].includes(canary.authenticatedControl) ||
    !["not_observed", "passed", "failed"].includes(canary.recentAdmission) ||
    (canary.observedAt !== null && typeof canary.observedAt !== "string")
  ) {
    throw new Error("status response has invalid rendezvous canary evidence");
  }
  if (
    rendezvous.reason !== null &&
    ![
      "no_observation",
      "malformed_observation",
      "stale_source",
      "canary_failed",
      "canary_passed",
      "authenticated_admission",
      "completed_session",
      "no_positive_evidence",
    ].includes(rendezvous.reason)
  ) {
    throw new Error("status response has an invalid rendezvous reason");
  }
  if (typeof rendezvous.error !== "string" && rendezvous.error !== null) {
    throw new Error("status response has an invalid rendezvous error");
  }
  if (
    typeof rendezvous.evidenceUrl !== "string" ||
    !rendezvous.evidenceUrl.includes("rendezvous-health.md")
  ) {
    throw new Error("status response has an invalid rendezvous evidence link");
  }
  return rendezvous;
}

async function fetchJson(url, label, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(
      `${label} request failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export async function verifyProduction(baseUrl, fetchImpl = fetch) {
  const productionUrl = new URL(baseUrl);
  if (productionUrl.protocol !== "https:") {
    throw new Error("production URL must use HTTPS");
  }
  if (productionUrl.username || productionUrl.password) {
    throw new Error("production URL must not contain credentials");
  }
  if (productionUrl.search || productionUrl.hash) {
    throw new Error("production URL must not contain a query or fragment");
  }

  const healthPayload = validateHealthPayload(
    await fetchJson(new URL("/api/healthz", productionUrl), "/api/healthz", fetchImpl),
  );
  const statusPayload = validateStatusPayload(
    await fetchJson(new URL("/api/status", productionUrl), "/api/status", fetchImpl),
  );
  validateClassicListings(statusPayload);
  validateClassicRendezvous(statusPayload);
  return { healthPayload, statusPayload };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const productionUrl = process.env.OBSERVATORY_PRODUCTION_URL;
  if (!productionUrl) {
    console.error("production smoke check requires OBSERVATORY_PRODUCTION_URL");
    process.exitCode = 1;
  } else {
    try {
      const { statusPayload } = await verifyProduction(productionUrl);
      console.log(
        JSON.stringify({
          status: "passed",
          schemaVersion: statusPayload.schemaVersion,
          coordinateCount: statusPayload.coordinates.length,
        }),
      );
    } catch (error) {
      console.error(
        `production smoke check failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
      process.exitCode = 1;
    }
  }
}
