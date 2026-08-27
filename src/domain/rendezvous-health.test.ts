import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  normalizeRendezvousHealthPayload,
  readBoundedJson,
  RENDEZVOUS_HEALTH_MAX_RESPONSE_BYTES,
  toRendezvousHealthObservation,
} from "./rendezvous-health";

const now = 1_777_060_802;
const malformedObservationFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../test/fixtures/rendezvous-health-v1-malformed-observation.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as unknown;

const payload = {
  schema: "rendezvous-health-v1",
  observation_generation: 12,
  source_timestamp: now - 2,
  observation_window: {
    started_at: now - 2,
    duration_seconds: 300,
    ended_at: now + 298,
  },
  freshness: {
    state: "fresh",
    age_seconds: 2,
    maximum_age_seconds: 300,
  },
  status: "healthy",
  recent_authenticated_admissions: 1,
  recent_sessions: {
    total: 2,
    outcomes: {
      completed: 1,
      client_disconnected: 0,
      session_expired: 0,
      protocol_error: 0,
      server_unavailable: 0,
      server_replaced: 0,
      authorization_failed: 0,
      internal_error: 1,
    },
  },
  canary: {
    type: "end_to_end",
    route: "reachable",
    authenticated_control: "passed",
    recent_admission: "passed",
    observed_at: now - 1,
  },
  reason: "canary_passed",
} as const;

const noObservationPayload = {
  schema: "rendezvous-health-v1",
  observation_generation: 0,
  source_timestamp: null,
  observation_window: {
    started_at: null,
    duration_seconds: 300,
    ended_at: null,
  },
  freshness: {
    state: "no_observation",
    age_seconds: null,
    maximum_age_seconds: 300,
  },
  status: "no_usable_observation",
  recent_authenticated_admissions: 0,
  recent_sessions: {
    total: 0,
    outcomes: {
      completed: 0,
      client_disconnected: 0,
      session_expired: 0,
      protocol_error: 0,
      server_unavailable: 0,
      server_replaced: 0,
      authorization_failed: 0,
      internal_error: 0,
    },
  },
  canary: {
    type: "none",
    route: "not_observed",
    authenticated_control: "not_observed",
    recent_admission: "not_observed",
    observed_at: null,
  },
  reason: "no_observation",
} as const;

describe("rendezvous health contract normalization", () => {
  it("accepts a fresh positive aggregate and returns only safe fields", () => {
    const normalized = normalizeRendezvousHealthPayload(payload, now);

    expect(normalized).toMatchObject({
      observationGeneration: 12,
      sourceTimestamp: now - 2,
      freshnessState: "fresh",
      sourceStatus: "healthy",
      recentAuthenticatedAdmissions: 1,
      reason: "canary_passed",
    });
    expect(JSON.stringify(normalized)).not.toMatch(
      /room_id|server_id|connection_id|candidate|credential|token|source_address/i,
    );
  });

  it.each([
    [
      "authenticated admission",
      { recent_authenticated_admissions: 1, reason: "authenticated_admission" },
    ],
    [
      "completed session",
      {
        recent_authenticated_admissions: 0,
        reason: "completed_session",
        recent_sessions: {
          ...payload.recent_sessions,
          total: 1,
          outcomes: {
            ...payload.recent_sessions.outcomes,
            completed: 1,
            internal_error: 0,
          },
        },
      },
    ],
  ])("accepts a fresh positive %s without a canary", (_label, overrides) => {
    const candidate = {
      ...payload,
      ...overrides,
      status: "healthy" as const,
      canary: {
        type: "none" as const,
        route: "not_observed" as const,
        authenticated_control: "not_observed" as const,
        recent_admission: "not_observed" as const,
        observed_at: null,
      },
    };
    expect(normalizeRendezvousHealthPayload(candidate, now)?.sourceStatus).toBe(
      "healthy",
    );
  });

  it("accepts an explicit failed canary without treating route reachability as success", () => {
    const failed = {
      ...payload,
      status: "failed" as const,
      recent_authenticated_admissions: 0,
      recent_sessions: {
        ...payload.recent_sessions,
        total: 0,
        outcomes: Object.fromEntries(
          Object.keys(payload.recent_sessions.outcomes).map((key) => [key, 0]),
        ),
      },
      canary: {
        type: "end_to_end" as const,
        route: "failed" as const,
        authenticated_control: "not_observed" as const,
        recent_admission: "not_observed" as const,
        observed_at: now - 1,
      },
      reason: "canary_failed" as const,
    };
    expect(normalizeRendezvousHealthPayload(failed, now)).toMatchObject({
      sourceStatus: "failed",
      reason: "canary_failed",
    });
  });

  it("accepts stale source data and preserves the stale reason", () => {
    const staleTimestamp = now - 301;
    const stale = {
      ...payload,
      source_timestamp: staleTimestamp,
      observation_window: {
        started_at: staleTimestamp,
        duration_seconds: 300,
        ended_at: staleTimestamp + 300,
      },
      freshness: {
        state: "stale" as const,
        age_seconds: 301,
        maximum_age_seconds: 300,
      },
      status: "stale" as const,
      recent_authenticated_admissions: 0,
      recent_sessions: noObservationPayload.recent_sessions,
      canary: noObservationPayload.canary,
      reason: "stale_source" as const,
    };
    expect(normalizeRendezvousHealthPayload(stale, now)).toMatchObject({
      freshnessState: "stale",
      sourceStatus: "stale",
      reason: "stale_source",
    });
  });

  it("accepts the authenticated empty aggregate as unknown", () => {
    expect(normalizeRendezvousHealthPayload(noObservationPayload, now)).toMatchObject({
      observationGeneration: 0,
      sourceTimestamp: null,
      freshnessState: "no_observation",
      sourceStatus: "no_usable_observation",
      reason: "no_observation",
    });
  });

  it("accepts the producer malformed-observation fallback as unknown", () => {
    expect(
      normalizeRendezvousHealthPayload(malformedObservationFixture, now),
    ).toMatchObject({
      observationGeneration: 0,
      sourceTimestamp: null,
      freshnessState: "no_observation",
      sourceStatus: "no_usable_observation",
      reason: "malformed_observation",
    });
  });

  it("rejects extra fields, inconsistent freshness, and route-only false positives", () => {
    expect(
      normalizeRendezvousHealthPayload({ ...payload, private_room_id: "secret" }, now),
    ).toBeNull();
    expect(
      normalizeRendezvousHealthPayload(
        { ...payload, freshness: { ...payload.freshness, age_seconds: 60 } },
        now,
      ),
    ).toBeNull();

    const routeOnly = {
      ...payload,
      status: "no_usable_observation" as const,
      recent_authenticated_admissions: 0,
      recent_sessions: noObservationPayload.recent_sessions,
      canary: {
        type: "route" as const,
        route: "reachable" as const,
        authenticated_control: "not_observed" as const,
        recent_admission: "not_observed" as const,
        observed_at: now - 1,
      },
      reason: "no_positive_evidence" as const,
    };
    expect(normalizeRendezvousHealthPayload(routeOnly, now)?.sourceStatus).toBe(
      "no_usable_observation",
    );
  });

  it("bounds and strictly decodes the response body", async () => {
    const oversized = new Response(
      "x".repeat(RENDEZVOUS_HEALTH_MAX_RESPONSE_BYTES + 1),
      {
        headers: {
          "content-length": String(RENDEZVOUS_HEALTH_MAX_RESPONSE_BYTES + 1),
        },
      },
    );
    await expect(readBoundedJson(oversized)).resolves.toBeNull();

    const invalidUtf8 = new Response(new Uint8Array([0xc3, 0x28]));
    await expect(readBoundedJson(invalidUtf8)).resolves.toBeNull();
  });

  it("requires a canonical received timestamp before persistence", () => {
    expect(
      toRendezvousHealthObservation(
        "observation-1",
        "2026-08-23T12:00:00.000Z",
        payload,
        now,
      ),
    ).not.toBeNull();
    expect(
      toRendezvousHealthObservation("observation-1", "not-a-date", payload, now),
    ).toBeNull();
  });
});
