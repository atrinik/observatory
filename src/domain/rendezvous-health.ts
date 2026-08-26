import type {
  RendezvousHealthCanary,
  RendezvousHealthError,
  RendezvousHealthObservation,
  RendezvousHealthReason,
  RendezvousHealthSessions,
  RendezvousHealthStatus,
  RendezvousHealthFreshnessState,
  RendezvousTerminalOutcome,
} from "./types";
import { RENDEZVOUS_TERMINAL_OUTCOMES } from "./types";

export const RENDEZVOUS_HEALTH_SCHEMA = "rendezvous-health-v1" as const;
export const INTERNAL_RENDEZVOUS_HEALTH_URL =
  "https://internal.atrinik.invalid/v1/rendezvous-health";
export const RENDEZVOUS_HEALTH_WINDOW_SECONDS = 300;
export const RENDEZVOUS_HEALTH_FRESHNESS_SECONDS = 300;
export const RENDEZVOUS_HEALTH_MAX_COUNTER = 1_000_000;
export const RENDEZVOUS_HEALTH_MAX_RESPONSE_BYTES = 16 * 1024;
export const RENDEZVOUS_OBSERVATION_SOURCE = "private-service-binding";

const MAX_SAFE_TIMESTAMP = Number.MAX_SAFE_INTEGER;
const OBSERVATION_KEYS = [
  "schema",
  "observation_generation",
  "source_timestamp",
  "observation_window",
  "freshness",
  "status",
  "recent_authenticated_admissions",
  "recent_sessions",
  "canary",
  "reason",
] as const;
const WINDOW_KEYS = ["started_at", "duration_seconds", "ended_at"] as const;
const FRESHNESS_KEYS = ["state", "age_seconds", "maximum_age_seconds"] as const;
const SESSION_KEYS = ["total", "outcomes"] as const;
const CANARY_KEYS = [
  "type",
  "route",
  "authenticated_control",
  "recent_admission",
  "observed_at",
] as const;
const STORED_OBSERVATION_KEYS = [
  "id",
  "receivedAt",
  "observationGeneration",
  "sourceTimestamp",
  "windowStartedAt",
  "windowEndedAt",
  "freshnessState",
  "sourceStatus",
  "recentAuthenticatedAdmissions",
  "recentSessions",
  "canary",
  "reason",
  "error",
] as const;

export interface RendezvousHealthSourcePayload {
  readonly schema: typeof RENDEZVOUS_HEALTH_SCHEMA;
  readonly observation_generation: number;
  readonly source_timestamp: number | null;
  readonly observation_window: {
    readonly started_at: number | null;
    readonly duration_seconds: typeof RENDEZVOUS_HEALTH_WINDOW_SECONDS;
    readonly ended_at: number | null;
  };
  readonly freshness: {
    readonly state: RendezvousHealthFreshnessState;
    readonly age_seconds: number | null;
    readonly maximum_age_seconds: typeof RENDEZVOUS_HEALTH_FRESHNESS_SECONDS;
  };
  readonly status: RendezvousHealthStatus;
  readonly recent_authenticated_admissions: number;
  readonly recent_sessions: {
    readonly total: number;
    readonly outcomes: Readonly<Record<RendezvousTerminalOutcome, number>>;
  };
  readonly canary: {
    readonly type: "none" | "route" | "end_to_end";
    readonly route: "not_observed" | "reachable" | "failed";
    readonly authenticated_control: "not_observed" | "passed" | "failed";
    readonly recent_admission: "not_observed" | "passed" | "failed";
    readonly observed_at: number | null;
  };
  readonly reason: RendezvousHealthReason;
}

export type NormalizedRendezvousHealth = Omit<
  RendezvousHealthObservation,
  "id" | "receivedAt" | "error"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => keys.includes(key)) &&
    keys.every((key) => actual.includes(key))
  );
}

function isSafeInteger(value: unknown, maximum = MAX_SAFE_TIMESTAMP): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isHealthStatus(value: unknown): value is RendezvousHealthStatus {
  return (
    value === "healthy" ||
    value === "failed" ||
    value === "stale" ||
    value === "no_usable_observation"
  );
}

function isHealthReason(value: unknown): value is RendezvousHealthReason {
  return (
    value === "no_observation" ||
    value === "malformed_observation" ||
    value === "stale_source" ||
    value === "canary_failed" ||
    value === "canary_passed" ||
    value === "authenticated_admission" ||
    value === "completed_session" ||
    value === "no_positive_evidence"
  );
}

function isFreshnessState(value: unknown): value is RendezvousHealthFreshnessState {
  return value === "fresh" || value === "stale" || value === "no_observation";
}

function isCanarySignal(value: unknown): value is "not_observed" | "passed" | "failed" {
  return value === "not_observed" || value === "passed" || value === "failed";
}

function zeroOutcomes(): Record<RendezvousTerminalOutcome, number> {
  return Object.fromEntries(
    RENDEZVOUS_TERMINAL_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<RendezvousTerminalOutcome, number>;
}

function normalizeSessions(value: unknown): RendezvousHealthSessions | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SESSION_KEYS)) return null;
  const outcomesValue = value.outcomes;
  if (!isRecord(outcomesValue)) return null;
  if (!hasOnlyKeys(outcomesValue, RENDEZVOUS_TERMINAL_OUTCOMES)) return null;

  const outcomes = zeroOutcomes();
  for (const outcome of RENDEZVOUS_TERMINAL_OUTCOMES) {
    const count = outcomesValue[outcome];
    if (!isSafeInteger(count, RENDEZVOUS_HEALTH_MAX_COUNTER)) return null;
    outcomes[outcome] = count;
  }
  const total = value.total;
  const calculatedTotal = Object.values(outcomes).reduce(
    (sum, count) => sum + count,
    0,
  );
  if (
    !isSafeInteger(
      total,
      RENDEZVOUS_HEALTH_MAX_COUNTER * RENDEZVOUS_TERMINAL_OUTCOMES.length,
    ) ||
    total !== calculatedTotal
  ) {
    return null;
  }
  return { total, outcomes };
}

function normalizeCanary(value: unknown): RendezvousHealthCanary | null {
  if (!isRecord(value) || !hasOnlyKeys(value, CANARY_KEYS)) return null;
  const type = value.type;
  const route = value.route;
  const authenticatedControl = value.authenticated_control;
  const recentAdmission = value.recent_admission;
  const observedAt = value.observed_at;

  if (type === "none") {
    if (
      route !== "not_observed" ||
      authenticatedControl !== "not_observed" ||
      recentAdmission !== "not_observed" ||
      observedAt !== null
    ) {
      return null;
    }
    return {
      type,
      route,
      authenticatedControl,
      recentAdmission,
      observedAt,
    };
  }

  if (type === "route") {
    if (
      (route !== "reachable" && route !== "failed") ||
      authenticatedControl !== "not_observed" ||
      recentAdmission !== "not_observed" ||
      !isSafeInteger(observedAt)
    ) {
      return null;
    }
    return {
      type,
      route,
      authenticatedControl,
      recentAdmission,
      observedAt,
    };
  }

  if (
    type !== "end_to_end" ||
    (route !== "reachable" && route !== "failed") ||
    !isCanarySignal(authenticatedControl) ||
    !isCanarySignal(recentAdmission) ||
    !isSafeInteger(observedAt)
  ) {
    return null;
  }
  if (
    route === "failed" &&
    (authenticatedControl !== "not_observed" || recentAdmission !== "not_observed")
  ) {
    return null;
  }
  if (
    route === "reachable" &&
    (authenticatedControl === "not_observed" || recentAdmission === "not_observed")
  ) {
    return null;
  }
  return {
    type,
    route,
    authenticatedControl,
    recentAdmission,
    observedAt,
  };
}

function derivedStatus(
  freshnessState: Exclude<RendezvousHealthFreshnessState, "no_observation">,
  canary: RendezvousHealthCanary,
  recentAuthenticatedAdmissions: number,
  sessions: RendezvousHealthSessions,
): { status: RendezvousHealthStatus; reason: RendezvousHealthReason } {
  const canaryFailed =
    canary.route === "failed" ||
    canary.authenticatedControl === "failed" ||
    canary.recentAdmission === "failed";
  const canaryPassed =
    canary.type === "end_to_end" &&
    canary.route === "reachable" &&
    canary.authenticatedControl === "passed" &&
    canary.recentAdmission === "passed";
  if (freshnessState === "stale") {
    return { status: "stale", reason: "stale_source" };
  }
  if (canaryFailed) return { status: "failed", reason: "canary_failed" };
  if (canaryPassed) return { status: "healthy", reason: "canary_passed" };
  if (recentAuthenticatedAdmissions > 0) {
    return { status: "healthy", reason: "authenticated_admission" };
  }
  if (sessions.outcomes.completed > 0) {
    return { status: "healthy", reason: "completed_session" };
  }
  return { status: "no_usable_observation", reason: "no_positive_evidence" };
}

function normalizeSourceWithTimestamp(
  value: Record<string, unknown>,
  nowSeconds: number,
): NormalizedRendezvousHealth | null {
  const generation = value.observation_generation;
  const sourceTimestamp = value.source_timestamp;
  const window = value.observation_window;
  const freshness = value.freshness;
  const status = value.status;
  const admissions = value.recent_authenticated_admissions;
  const sessions = normalizeSessions(value.recent_sessions);
  const canary = normalizeCanary(value.canary);
  const reason = value.reason;

  if (
    !isSafeInteger(generation) ||
    generation < 1 ||
    !isSafeInteger(sourceTimestamp) ||
    !isRecord(window) ||
    !hasOnlyKeys(window, WINDOW_KEYS) ||
    !isSafeInteger(window.started_at) ||
    !isSafeInteger(window.ended_at) ||
    window.duration_seconds !== RENDEZVOUS_HEALTH_WINDOW_SECONDS ||
    window.started_at > sourceTimestamp ||
    sourceTimestamp - window.started_at >= RENDEZVOUS_HEALTH_WINDOW_SECONDS ||
    sourceTimestamp >= window.ended_at ||
    window.ended_at - window.started_at !== RENDEZVOUS_HEALTH_WINDOW_SECONDS ||
    !isRecord(freshness) ||
    !hasOnlyKeys(freshness, FRESHNESS_KEYS) ||
    (freshness.state !== "fresh" && freshness.state !== "stale") ||
    !isSafeInteger(freshness.age_seconds) ||
    freshness.maximum_age_seconds !== RENDEZVOUS_HEALTH_FRESHNESS_SECONDS ||
    !isHealthStatus(status) ||
    !isSafeInteger(admissions, RENDEZVOUS_HEALTH_MAX_COUNTER) ||
    sessions === null ||
    canary === null ||
    !isHealthReason(reason) ||
    !isSafeInteger(nowSeconds) ||
    sourceTimestamp > nowSeconds ||
    (canary.observedAt !== null && canary.observedAt > nowSeconds)
  ) {
    return null;
  }

  const calculatedAge = nowSeconds - sourceTimestamp;
  if (
    Math.abs(freshness.age_seconds - calculatedAge) > 5 ||
    calculatedAge > RENDEZVOUS_HEALTH_FRESHNESS_SECONDS !==
      (freshness.state === "stale")
  ) {
    return null;
  }
  const derived = derivedStatus(freshness.state, canary, admissions, sessions);
  if (status !== derived.status || reason !== derived.reason) return null;

  return {
    observationGeneration: generation,
    sourceTimestamp,
    windowStartedAt: window.started_at,
    windowEndedAt: window.ended_at,
    freshnessState: freshness.state,
    sourceStatus: status,
    recentAuthenticatedAdmissions: admissions,
    recentSessions: sessions,
    canary,
    reason,
  };
}

export function normalizeRendezvousHealthPayload(
  value: unknown,
  nowSeconds: number,
): NormalizedRendezvousHealth | null {
  if (!isRecord(value) || !hasOnlyKeys(value, OBSERVATION_KEYS)) return null;
  if (value.schema !== RENDEZVOUS_HEALTH_SCHEMA) return null;

  if (value.source_timestamp === null) {
    const window = value.observation_window;
    const freshness = value.freshness;
    const sessions = normalizeSessions(value.recent_sessions);
    const canary = normalizeCanary(value.canary);
    if (
      value.observation_generation !== 0 ||
      !isRecord(window) ||
      !hasOnlyKeys(window, WINDOW_KEYS) ||
      window.started_at !== null ||
      window.duration_seconds !== RENDEZVOUS_HEALTH_WINDOW_SECONDS ||
      window.ended_at !== null ||
      !isRecord(freshness) ||
      !hasOnlyKeys(freshness, FRESHNESS_KEYS) ||
      freshness.state !== "no_observation" ||
      freshness.age_seconds !== null ||
      freshness.maximum_age_seconds !== RENDEZVOUS_HEALTH_FRESHNESS_SECONDS ||
      value.status !== "no_usable_observation" ||
      value.recent_authenticated_admissions !== 0 ||
      sessions === null ||
      sessions.total !== 0 ||
      Object.values(sessions.outcomes).some((count) => count !== 0) ||
      canary === null ||
      canary.type !== "none" ||
      canary.observedAt !== null ||
      value.reason !== "no_observation"
    ) {
      return null;
    }
    if (!isSafeInteger(nowSeconds)) return null;
    return {
      observationGeneration: 0,
      sourceTimestamp: null,
      windowStartedAt: null,
      windowEndedAt: null,
      freshnessState: "no_observation",
      sourceStatus: "no_usable_observation",
      recentAuthenticatedAdmissions: 0,
      recentSessions: sessions,
      canary,
      reason: "no_observation",
    };
  }

  return normalizeSourceWithTimestamp(value, nowSeconds);
}

export function toRendezvousHealthObservation(
  id: string,
  receivedAt: string,
  value: unknown,
  nowSeconds: number,
): RendezvousHealthObservation | null {
  const normalized = normalizeRendezvousHealthPayload(value, nowSeconds);
  if (
    normalized === null ||
    !isString(id) ||
    id.length === 0 ||
    id.length > 128 ||
    !isString(receivedAt) ||
    !isIsoTimestamp(receivedAt)
  ) {
    return null;
  }
  return { id, receivedAt, ...normalized, error: null };
}

export function unavailableRendezvousHealthObservation(
  id: string,
  receivedAt: string,
  error: RendezvousHealthError,
): RendezvousHealthObservation {
  return {
    id,
    receivedAt,
    observationGeneration: 0,
    sourceTimestamp: null,
    windowStartedAt: null,
    windowEndedAt: null,
    freshnessState: "no_observation",
    sourceStatus: null,
    recentAuthenticatedAdmissions: 0,
    recentSessions: { total: 0, outcomes: zeroOutcomes() },
    canary: {
      type: "none",
      route: "not_observed",
      authenticatedControl: "not_observed",
      recentAdmission: "not_observed",
      observedAt: null,
    },
    reason: null,
    error,
  };
}

export function emptyRendezvousHealthSessions(): RendezvousHealthSessions {
  return { total: 0, outcomes: zeroOutcomes() };
}

function isStoredCanary(value: unknown): value is RendezvousHealthCanary {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "type",
      "route",
      "authenticatedControl",
      "recentAdmission",
      "observedAt",
    ])
  ) {
    return false;
  }
  if (
    (value.type !== "none" && value.type !== "route" && value.type !== "end_to_end") ||
    (value.route !== "not_observed" &&
      value.route !== "reachable" &&
      value.route !== "failed") ||
    !isCanarySignal(value.authenticatedControl) ||
    !isCanarySignal(value.recentAdmission) ||
    (value.observedAt !== null && !isSafeInteger(value.observedAt))
  ) {
    return false;
  }
  if (value.type === "none") {
    return (
      value.route === "not_observed" &&
      value.authenticatedControl === "not_observed" &&
      value.recentAdmission === "not_observed" &&
      value.observedAt === null
    );
  }
  if (value.observedAt === null) return false;
  if (value.type === "route") {
    return (
      (value.route === "reachable" || value.route === "failed") &&
      value.authenticatedControl === "not_observed" &&
      value.recentAdmission === "not_observed"
    );
  }
  return (
    (value.route === "reachable" || value.route === "failed") &&
    (value.route !== "failed" ||
      (value.authenticatedControl === "not_observed" &&
        value.recentAdmission === "not_observed")) &&
    (value.route !== "reachable" ||
      (value.authenticatedControl !== "not_observed" &&
        value.recentAdmission !== "not_observed"))
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isStoredSessions(value: unknown): value is RendezvousHealthSessions {
  if (!isRecord(value) || !hasOnlyKeys(value, SESSION_KEYS)) return false;
  const outcomes = value.outcomes;
  if (!isRecord(outcomes) || !hasOnlyKeys(outcomes, RENDEZVOUS_TERMINAL_OUTCOMES)) {
    return false;
  }
  let total = 0;
  for (const outcome of RENDEZVOUS_TERMINAL_OUTCOMES) {
    const count = outcomes[outcome];
    if (!isSafeInteger(count, RENDEZVOUS_HEALTH_MAX_COUNTER)) return false;
    total += count;
  }
  return value.total === total;
}

export function normalizeStoredRendezvousHealthObservation(
  value: unknown,
  nowSeconds?: number,
): RendezvousHealthObservation | null {
  if (!isRecord(value) || !hasOnlyKeys(value, STORED_OBSERVATION_KEYS)) return null;
  if (
    !isString(value.id) ||
    value.id.length === 0 ||
    value.id.length > 128 ||
    !isIsoTimestamp(value.receivedAt)
  ) {
    return null;
  }
  const observationGeneration = value.observationGeneration;
  const sourceTimestamp = value.sourceTimestamp;
  const windowStartedAt = value.windowStartedAt;
  const windowEndedAt = value.windowEndedAt;
  const freshnessState = value.freshnessState;
  const sourceStatus = value.sourceStatus;
  const recentAuthenticatedAdmissions = value.recentAuthenticatedAdmissions;
  const recentSessions = value.recentSessions;
  const canary = value.canary;
  const reason = value.reason;
  const error = value.error;

  if (
    !isSafeInteger(observationGeneration) ||
    (!isSafeInteger(sourceTimestamp) && sourceTimestamp !== null) ||
    (!isSafeInteger(windowStartedAt) && windowStartedAt !== null) ||
    (!isSafeInteger(windowEndedAt) && windowEndedAt !== null) ||
    !isFreshnessState(freshnessState) ||
    (sourceStatus !== null && !isHealthStatus(sourceStatus)) ||
    !isSafeInteger(recentAuthenticatedAdmissions, RENDEZVOUS_HEALTH_MAX_COUNTER) ||
    !isStoredSessions(recentSessions) ||
    !isStoredCanary(canary) ||
    (reason !== null && !isHealthReason(reason)) ||
    (error !== null &&
      error !== "source_not_configured" &&
      error !== "source_unauthorized" &&
      error !== "source_unavailable" &&
      error !== "malformed_source")
  ) {
    return null;
  }

  if (
    nowSeconds !== undefined &&
    (!isSafeInteger(nowSeconds) ||
      (sourceTimestamp !== null && sourceTimestamp > nowSeconds) ||
      (canary.observedAt !== null && canary.observedAt > nowSeconds))
  ) {
    return null;
  }

  if (error !== null) {
    if (
      sourceStatus !== null ||
      observationGeneration !== 0 ||
      sourceTimestamp !== null ||
      windowStartedAt !== null ||
      windowEndedAt !== null ||
      freshnessState !== "no_observation" ||
      recentAuthenticatedAdmissions !== 0 ||
      recentSessions.total !== 0 ||
      Object.values(recentSessions.outcomes).some((count) => count !== 0) ||
      canary.type !== "none" ||
      canary.observedAt !== null ||
      reason !== null
    ) {
      return null;
    }
    return {
      id: value.id,
      receivedAt: value.receivedAt,
      observationGeneration,
      sourceTimestamp,
      windowStartedAt,
      windowEndedAt,
      freshnessState,
      sourceStatus,
      recentAuthenticatedAdmissions,
      recentSessions,
      canary,
      reason,
      error,
    };
  }

  if (
    sourceStatus === null ||
    reason === null ||
    (sourceTimestamp === null && freshnessState !== "no_observation") ||
    (sourceTimestamp !== null &&
      (windowStartedAt === null ||
        windowEndedAt === null ||
        freshnessState === "no_observation"))
  ) {
    return null;
  }
  if (sourceTimestamp === null) {
    return sourceStatus === "no_usable_observation" &&
      freshnessState === "no_observation" &&
      reason === "no_observation" &&
      windowStartedAt === null &&
      windowEndedAt === null &&
      recentAuthenticatedAdmissions === 0 &&
      recentSessions.total === 0 &&
      Object.values(recentSessions.outcomes).every((count) => count === 0) &&
      canary.type === "none" &&
      canary.observedAt === null
      ? {
          id: value.id,
          receivedAt: value.receivedAt,
          observationGeneration,
          sourceTimestamp,
          windowStartedAt,
          windowEndedAt,
          freshnessState,
          sourceStatus,
          recentAuthenticatedAdmissions,
          recentSessions,
          canary,
          reason,
          error,
        }
      : null;
  }

  if (freshnessState === "no_observation") return null;

  if (
    observationGeneration < 1 ||
    windowStartedAt === null ||
    windowEndedAt === null ||
    sourceTimestamp < windowStartedAt ||
    sourceTimestamp >= windowEndedAt ||
    windowEndedAt - windowStartedAt !== RENDEZVOUS_HEALTH_WINDOW_SECONDS
  ) {
    return null;
  }
  const derived = derivedStatus(
    freshnessState,
    canary,
    recentAuthenticatedAdmissions,
    recentSessions,
  );
  if (sourceStatus !== derived.status || reason !== derived.reason) return null;
  return {
    id: value.id,
    receivedAt: value.receivedAt,
    observationGeneration,
    sourceTimestamp,
    windowStartedAt,
    windowEndedAt,
    freshnessState,
    sourceStatus,
    recentAuthenticatedAdmissions,
    recentSessions,
    canary,
    reason,
    error,
  };
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes = RENDEZVOUS_HEALTH_MAX_RESPONSE_BYTES,
): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes) {
      await discardResponseBody(response);
      return null;
    }
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    if (response.body) await response.body.cancel();
  } catch {
    // The response is already being rejected; cancellation failure is safe to ignore.
  }
}

export async function readBoundedJson(
  response: Response,
  maxBytes = RENDEZVOUS_HEALTH_MAX_RESPONSE_BYTES,
): Promise<unknown | null> {
  const text = await readBoundedResponseText(response, maxBytes);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
