import { aggregateDashboard } from "../domain/aggregate";
import { SERVICE_PROBES } from "../domain/components";
import { extractListingMetadata, MAX_LISTING_BODY_BYTES } from "../domain/metaserver";
import type {
  ComponentCoordinate,
  CoordinateEvidenceKind,
  ListingFormat,
  NormalizedObservation,
  ObservationStatus,
  ServiceSurface,
  ServiceObservation,
  ServiceProbe,
} from "../domain/types";
import type { StoredObservation } from "../domain/aggregate";

interface CoordinateRow {
  id: string;
  repository: string;
  component: string;
  stack: "default" | "classic";
  generation: "replacement" | "classic" | "shared";
  deployment_applicable: number;
}

interface ObservationRow {
  id: string;
  coordinate_id: string;
  kind: CoordinateEvidenceKind;
  status: ObservationStatus;
  observed_at: string;
  received_at: string;
  ref: string | null;
  commit_sha: string | null;
  title: string;
  source_url: string | null;
  workflow_name: string | null;
  release_tag: string | null;
  package_url: string | null;
  artifact_url: string | null;
}

interface ServiceProbeRow {
  id: string;
  name: string;
  url: string;
  stack: "default" | "classic";
  stale_after_seconds: number;
  surface: ServiceSurface;
  format: ListingFormat | null;
}

interface ServiceObservationRow {
  id: string;
  probe_id: string;
  status: ObservationStatus;
  observed_at: string;
  status_code: number | null;
  response_ms: number | null;
  error: string | null;
  format: ListingFormat | null;
  generation: string | null;
  entry_count: number | null;
  parity_key: string | null;
}

export interface DeliveryResult {
  duplicate: boolean;
  conflict: boolean;
  inserted: number;
  mapped: number;
}

function toCoordinate(row: CoordinateRow): ComponentCoordinate {
  return {
    id: row.id,
    repository: row.repository,
    component: row.component,
    stack: row.stack,
    generation: row.generation,
    deploymentApplicable: row.deployment_applicable === 1,
  };
}

function toStoredObservation(row: ObservationRow): StoredObservation {
  return {
    id: row.id,
    coordinateId: row.coordinate_id,
    kind: row.kind,
    status: row.status,
    observedAt: row.observed_at,
    receivedAt: row.received_at,
    ref: row.ref,
    commitSha: row.commit_sha,
    title: row.title,
    sourceUrl: row.source_url,
    workflowName: row.workflow_name,
    releaseTag: row.release_tag,
    packageUrl: row.package_url,
    artifactUrl: row.artifact_url,
  };
}

function toProbe(row: ServiceProbeRow): ServiceProbe {
  const definition = SERVICE_PROBES.find((probe) => probe.id === row.id);
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    stack: row.stack,
    staleAfterSeconds: row.stale_after_seconds,
    surface: row.surface,
    format: row.format,
    evidenceUrl: definition?.evidenceUrl ?? row.url,
  };
}

function toServiceObservation(row: ServiceObservationRow): ServiceObservation {
  return {
    id: row.id,
    probeId: row.probe_id,
    status: row.status,
    observedAt: row.observed_at,
    statusCode: row.status_code,
    responseMs: row.response_ms,
    error: row.error,
    format: row.format,
    generation: row.generation,
    entryCount: row.entry_count,
    parityKey: row.parity_key,
  };
}

function envSeconds(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function readDashboard(
  db: D1Database,
  now: Date,
  staleAfterSecondsValue?: string,
) {
  const [coordinateResult, observationResult, probeResult, serviceResult] =
    await Promise.all([
      db
        .prepare(
          "SELECT id, repository, component, stack, generation, deployment_applicable FROM component_coordinates ORDER BY stack, component",
        )
        .all<CoordinateRow>(),
      db
        .prepare(
          "SELECT id, coordinate_id, kind, status, observed_at, received_at, ref, commit_sha, title, source_url, workflow_name, release_tag, package_url, artifact_url FROM coordinate_observations",
        )
        .all<ObservationRow>(),
      db
        .prepare(
          "SELECT id, name, url, stack, stale_after_seconds, surface, format FROM service_probes ORDER BY stack, surface, name",
        )
        .all<ServiceProbeRow>(),
      db
        .prepare(
          "SELECT id, probe_id, status, observed_at, status_code, response_ms, error, format, generation, entry_count, parity_key FROM service_observations",
        )
        .all<ServiceObservationRow>(),
    ]);

  const coordinates = coordinateResult.results.map(toCoordinate);
  const observations = observationResult.results.map(toStoredObservation);
  const probes = probeResult.results.map(toProbe);
  const serviceObservations = serviceResult.results.map(toServiceObservation);
  return aggregateDashboard(
    coordinates,
    observations,
    probes,
    serviceObservations,
    now,
    envSeconds(staleAfterSecondsValue, 21600),
  );
}

export async function recordGitHubDelivery(
  db: D1Database,
  deliveryId: string,
  eventName: string,
  payloadDigest: string,
  receivedAt: string,
  normalized: NormalizedObservation[],
): Promise<DeliveryResult> {
  const coordinates = await db
    .prepare(
      "SELECT id, repository, component, stack, generation, deployment_applicable FROM component_coordinates WHERE repository = ? ORDER BY stack, component",
    )
    .bind(normalized[0]?.repository ?? "")
    .all<CoordinateRow>();
  const observationStatements: D1PreparedStatement[] = [];
  let sequence = 0;
  for (const coordinate of coordinates.results) {
    for (const observation of normalized) {
      const id = `${deliveryId}:${coordinate.id}:${sequence}`;
      sequence += 1;
      observationStatements.push(
        db
          .prepare(
            "INSERT OR IGNORE INTO coordinate_observations (id, delivery_id, coordinate_id, kind, status, observed_at, received_at, ref, commit_sha, title, source_url, workflow_name, release_tag, package_url, artifact_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            id,
            deliveryId,
            coordinate.id,
            observation.kind,
            observation.status,
            observation.occurredAt,
            receivedAt,
            observation.ref,
            observation.commitSha,
            observation.title,
            observation.sourceUrl,
            observation.workflowName,
            observation.releaseTag,
            observation.packageUrl,
            observation.artifactUrl,
          ),
      );
    }
  }

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT OR IGNORE INTO github_deliveries (delivery_id, event_name, payload_digest, received_at, outcome) VALUES (?, ?, ?, ?, 'pending')",
      )
      .bind(deliveryId, eventName, payloadDigest, receivedAt),
    ...observationStatements,
    db
      .prepare("UPDATE github_deliveries SET outcome = ? WHERE delivery_id = ?")
      .bind(observationStatements.length > 0 ? "accepted" : "ignored", deliveryId),
  ];
  const results = await db.batch(statements);
  if (results[0]?.meta.changes !== 1) {
    const existing = await db
      .prepare("SELECT payload_digest FROM github_deliveries WHERE delivery_id = ?")
      .bind(deliveryId)
      .first<{ payload_digest: string }>();
    return {
      duplicate: true,
      conflict: existing?.payload_digest !== payloadDigest,
      inserted: 0,
      mapped: 0,
    };
  }
  const inserted = results
    .slice(1, observationStatements.length + 1)
    .reduce((count, result) => count + result.meta.changes, 0);
  return {
    duplicate: false,
    conflict: false,
    inserted,
    mapped: normalized.length > 0 ? coordinates.results.length : 0,
  };
}

export async function recordServiceObservation(
  db: D1Database,
  observation: ServiceObservation,
): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO service_observations (id, probe_id, status, observed_at, status_code, response_ms, error, format, generation, entry_count, parity_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      observation.id,
      observation.probeId,
      observation.status,
      observation.observedAt,
      observation.statusCode,
      observation.responseMs,
      observation.error,
      observation.format,
      observation.generation,
      observation.entryCount,
      observation.parityKey,
    )
    .run();
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number.parseInt(
    response.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    if (response.body) await response.body.cancel();
    return "";
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return "";
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function probeOne(
  probe: ServiceProbe,
  timeoutMs: number,
): Promise<ServiceObservation> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(probe.url, {
      method: "GET",
      headers: { "user-agent": "Atrinik-Observatory-Health/1.0" },
      redirect: "manual",
      signal: controller.signal,
    });
    const metadata =
      response.ok && probe.surface === "listings" && probe.format
        ? extractListingMetadata(
            probe.format,
            await readBoundedText(response, MAX_LISTING_BODY_BYTES),
            response.headers,
          )
        : { generation: null, entryCount: null, parityKey: null };
    if (response.body && (!response.ok || probe.surface !== "listings")) {
      await response.body.cancel();
    }
    const observedAt = new Date().toISOString();
    return {
      id: `${probe.id}:${observedAt}`,
      probeId: probe.id,
      status: response.ok ? "passed" : "failed",
      observedAt,
      statusCode: response.status,
      responseMs: Date.now() - startedAt,
      error: response.ok ? null : `${response.status} ${response.statusText}`.trim(),
      format: probe.format,
      generation: metadata.generation,
      entryCount: metadata.entryCount,
      parityKey: metadata.parityKey,
    };
  } catch (error) {
    const observedAt = new Date().toISOString();
    return {
      id: `${probe.id}:${observedAt}`,
      probeId: probe.id,
      status: "failed",
      observedAt,
      statusCode: null,
      responseMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 240) : "probe failed",
      format: probe.format,
      generation: null,
      entryCount: null,
      parityKey: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runServiceProbes(
  db: D1Database,
  timeoutMsValue: string | undefined,
): Promise<number> {
  const result = await db
    .prepare(
      "SELECT id, name, url, stack, stale_after_seconds, surface, format FROM service_probes ORDER BY id",
    )
    .all<ServiceProbeRow>();
  const probes =
    result.results.length > 0 ? result.results.map(toProbe) : SERVICE_PROBES;
  const timeoutMs = envSeconds(timeoutMsValue, 5000);
  const observations = await Promise.all(
    probes
      .filter((probe) => probe.surface === "service" || probe.surface === "listings")
      .map((probe) => probeOne(probe, timeoutMs)),
  );
  await db.batch(
    observations.map((observation) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO service_observations (id, probe_id, status, observed_at, status_code, response_ms, error, format, generation, entry_count, parity_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          observation.id,
          observation.probeId,
          observation.status,
          observation.observedAt,
          observation.statusCode,
          observation.responseMs,
          observation.error,
          observation.format,
          observation.generation,
          observation.entryCount,
          observation.parityKey,
        ),
    ),
  );
  return observations.length;
}
