import { COMPONENT_COORDINATES, SERVICE_PROBES } from "./components";
import type {
  ComponentCoordinate,
  CoordinateEvidenceKind,
  DashboardCoordinate,
  DashboardStatus,
  EvidenceRecord,
  EvidenceSummary,
  ObservationStatus,
  ServiceObservation,
  ServiceProbe,
  ServiceSummary,
} from "./types";

export interface StoredObservation extends EvidenceRecord {
  coordinateId: string;
  kind: CoordinateEvidenceKind;
}

const STATUS_RANK: Record<ObservationStatus | "stale", number> = {
  passed: 1,
  unknown: 2,
  running: 3,
  stale: 4,
  failed: 5,
  cancelled: 5,
};

function timestampValue(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function compareNewest(left: EvidenceRecord, right: EvidenceRecord): number {
  const observed = timestampValue(right.observedAt) - timestampValue(left.observedAt);
  if (observed !== 0) return observed;
  return timestampValue(right.receivedAt) - timestampValue(left.receivedAt);
}

function emptyEvidence(): EvidenceSummary {
  return {
    status: "unknown",
    lastObservedStatus: null,
    observedAt: null,
    ageSeconds: null,
    stale: false,
    latest: null,
    lastKnownGood: null,
    mostRecentFailure: null,
  };
}

function notTrackedEvidence(): EvidenceSummary {
  return {
    ...emptyEvidence(),
    status: "not-tracked",
  };
}

function summarizeEvidence(
  records: EvidenceRecord[],
  now: Date,
  staleAfterSeconds: number,
): EvidenceSummary {
  if (records.length === 0) return emptyEvidence();

  const ordered = [...records].sort(compareNewest);
  const latest = ordered[0];
  if (!latest) return emptyEvidence();

  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - timestampValue(latest.observedAt)) / 1000),
  );
  const stale = ageSeconds > staleAfterSeconds;
  const lastKnownGood = ordered.find((record) => record.status === "passed") ?? null;
  const mostRecentFailure =
    ordered.find(
      (record) => record.status === "failed" || record.status === "cancelled",
    ) ?? null;

  return {
    status: stale ? "stale" : latest.status,
    lastObservedStatus: latest.status,
    observedAt: latest.observedAt,
    ageSeconds,
    stale,
    latest,
    lastKnownGood,
    mostRecentFailure,
  };
}

function worstStatus(
  statuses: Array<ObservationStatus | "stale">,
): ObservationStatus | "stale" {
  return statuses.reduce<ObservationStatus | "stale">(
    (worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst),
    "passed",
  );
}

function coordinateOverall(
  coordinate: DashboardCoordinate,
): ObservationStatus | "stale" {
  const statuses = [
    coordinate.build.status,
    coordinate.release.status,
    coordinate.package.status,
  ].map((status) => (status === "not-tracked" ? "unknown" : status));
  if (coordinate.deploymentApplicable) {
    statuses.push(
      coordinate.deployment.status === "not-tracked"
        ? "unknown"
        : coordinate.deployment.status,
    );
  }
  return worstStatus(statuses);
}

function aggregateSummary(coordinates: DashboardCoordinate[]) {
  return coordinates.reduce(
    (summary, coordinate) => {
      summary.total += 1;
      if (coordinate.overall === "passed") summary.healthy += 1;
      if (coordinate.overall === "failed" || coordinate.overall === "cancelled") {
        summary.attention += 1;
      }
      if (coordinate.overall === "stale") summary.stale += 1;
      if (coordinate.overall === "unknown") summary.unknown += 1;
      return summary;
    },
    { total: 0, healthy: 0, attention: 0, stale: 0, unknown: 0 },
  );
}

function coordinateEvidence(
  coordinate: ComponentCoordinate,
  observations: StoredObservation[],
  kind: CoordinateEvidenceKind,
  now: Date,
  staleAfterSeconds: number,
): EvidenceSummary {
  const records = observations
    .filter(
      (observation) =>
        observation.coordinateId === coordinate.id && observation.kind === kind,
    )
    .map(({ coordinateId: _coordinateId, kind: _kind, ...record }) => record);
  return summarizeEvidence(records, now, staleAfterSeconds);
}

function deploymentEvidence(
  coordinate: ComponentCoordinate,
  observations: StoredObservation[],
  now: Date,
  staleAfterSeconds: number,
): EvidenceSummary {
  if (!coordinate.deploymentApplicable) return notTrackedEvidence();
  return coordinateEvidence(
    coordinate,
    observations,
    "deployment",
    now,
    staleAfterSeconds,
  );
}

function serviceSummary(
  probe: ServiceProbe,
  observations: ServiceObservation[],
  now: Date,
): ServiceSummary {
  const ordered = observations
    .filter((observation) => observation.probeId === probe.id)
    .sort(
      (left, right) =>
        timestampValue(right.observedAt) - timestampValue(left.observedAt),
    );
  const latest = ordered[0];
  if (!latest) {
    return {
      ...probe,
      status: "unknown",
      lastObservedStatus: null,
      observedAt: null,
      ageSeconds: null,
      stale: false,
      statusCode: null,
      responseMs: null,
      error: null,
    };
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - timestampValue(latest.observedAt)) / 1000),
  );
  const stale = ageSeconds > probe.staleAfterSeconds;
  return {
    ...probe,
    status: stale ? "stale" : latest.status,
    lastObservedStatus: latest.status,
    observedAt: latest.observedAt,
    ageSeconds,
    stale,
    statusCode: latest.statusCode,
    responseMs: latest.responseMs,
    error: latest.error,
  };
}

export function aggregateDashboard(
  coordinates: ComponentCoordinate[],
  observations: StoredObservation[],
  probes: ServiceProbe[],
  serviceObservations: ServiceObservation[],
  now: Date,
  staleAfterSeconds: number,
): DashboardStatus {
  const dashboardCoordinates = coordinates.map((coordinate) => {
    const dashboardCoordinate: DashboardCoordinate = {
      ...coordinate,
      overall: "unknown",
      build: coordinateEvidence(
        coordinate,
        observations,
        "build",
        now,
        staleAfterSeconds,
      ),
      release: coordinateEvidence(
        coordinate,
        observations,
        "release",
        now,
        staleAfterSeconds,
      ),
      package: coordinateEvidence(
        coordinate,
        observations,
        "package",
        now,
        staleAfterSeconds,
      ),
      deployment: deploymentEvidence(coordinate, observations, now, staleAfterSeconds),
    };
    dashboardCoordinate.overall = coordinateOverall(dashboardCoordinate);
    return dashboardCoordinate;
  });

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    staleAfterSeconds,
    coordinates: dashboardCoordinates,
    services: probes.map((probe) => serviceSummary(probe, serviceObservations, now)),
    summary: aggregateSummary(dashboardCoordinates),
  };
}

export function emptyDashboard(
  coordinates: ComponentCoordinate[] = COMPONENT_COORDINATES,
  probes: ServiceProbe[] = SERVICE_PROBES,
  staleAfterSeconds = 21600,
): DashboardStatus {
  const dashboard = aggregateDashboard(
    coordinates,
    [],
    probes,
    [],
    new Date(0),
    staleAfterSeconds,
  );
  return { ...dashboard, generatedAt: null };
}

export function filterDashboardByStack(
  dashboard: DashboardStatus,
  stack: string | null,
): DashboardStatus {
  if (stack !== "default" && stack !== "classic") return dashboard;
  const coordinates = dashboard.coordinates.filter(
    (coordinate) => coordinate.stack === stack,
  );
  const services = dashboard.services.filter((service) => service.stack === stack);
  return {
    ...dashboard,
    coordinates,
    services,
    summary: aggregateSummary(coordinates),
  };
}
