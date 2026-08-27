import {
  COMPONENT_COORDINATES,
  METASERVER_LISTING_EVIDENCE_URL,
  METASERVER_RENDEZVOUS_EVIDENCE_URL,
  SERVICE_PROBES,
} from "./components";
import {
  emptyRendezvousHealthSessions,
  normalizeStoredRendezvousHealthObservation,
  RENDEZVOUS_HEALTH_FRESHNESS_SECONDS,
  RENDEZVOUS_OBSERVATION_SOURCE,
} from "./rendezvous-health";
import { LISTING_FORMATS } from "./types";
import { isPersistableEvidence } from "./build-evidence";
import type {
  ComponentCoordinate,
  CoordinateEvidenceKind,
  DashboardCoordinate,
  DashboardService,
  DashboardStatus,
  DisplayStatus,
  EvidenceRecord,
  EvidenceSummary,
  ListingFormat,
  ListingFormatSummary,
  ListingsSurfaceSummary,
  MetaserverServiceSummary,
  ObservationStatus,
  RendezvousSurfaceSummary,
  RendezvousHealthObservation,
  ServiceObservation,
  ServiceProbe,
  ServiceSummary,
} from "./types";

export interface StoredObservation extends EvidenceRecord {
  coordinateId: string;
  kind: CoordinateEvidenceKind;
}

const STATUS_RANK: Record<ObservationStatus | "attention" | "stale", number> = {
  passed: 1,
  unknown: 2,
  running: 3,
  attention: 4,
  stale: 4,
  failed: 5,
  cancelled: 5,
};

const LISTING_FORMAT_LABELS: Record<ListingFormat, string> = {
  html: "/index.html",
  json: "/index.json",
  xml: "/index.xml",
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

function summarizeEventEvidence(records: EvidenceRecord[], now: Date): EvidenceSummary {
  if (records.length === 0) return emptyEvidence();

  const ordered = [...records].sort(compareNewest);
  const latest = ordered[0];
  if (!latest) return emptyEvidence();

  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - timestampValue(latest.observedAt)) / 1000),
  );
  const lastKnownGood = ordered.find((record) => record.status === "passed") ?? null;
  const mostRecentFailure =
    ordered.find(
      (record) => record.status === "failed" || record.status === "cancelled",
    ) ?? null;

  return {
    status: latest.status,
    lastObservedStatus: latest.status,
    observedAt: latest.observedAt,
    ageSeconds,
    stale: false,
    latest,
    lastKnownGood,
    mostRecentFailure,
  };
}

function worstStatus(statuses: DisplayStatus[]): DisplayStatus {
  return statuses.reduce<DisplayStatus>((worst, status) => {
    const normalized = status === "not-tracked" ? "unknown" : status;
    const worstRank = STATUS_RANK[worst === "not-tracked" ? "unknown" : worst];
    return STATUS_RANK[normalized] > worstRank ? normalized : worst;
  }, "passed");
}

function coordinateOverall(
  coordinate: DashboardCoordinate,
): ObservationStatus | "stale" {
  const statuses: DisplayStatus[] = [
    coordinate.build.status,
    coordinate.release.status,
    coordinate.package.status,
  ];
  if (coordinate.deploymentApplicable) statuses.push(coordinate.deployment.status);
  return worstStatus(statuses) as ObservationStatus | "stale";
}

function aggregateSummary(coordinates: DashboardCoordinate[]) {
  return coordinates.reduce(
    (summary, coordinate) => {
      summary.total += 1;
      if (coordinate.overall === "passed") summary.healthy += 1;
      if (
        coordinate.overall === "failed" ||
        coordinate.overall === "cancelled" ||
        coordinate.overall === "running" ||
        coordinate.overall === "attention"
      ) {
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
): EvidenceSummary {
  const records = observations
    .filter(
      (observation) =>
        isPersistableEvidence(observation) &&
        observation.coordinateId === coordinate.id &&
        observation.kind === kind,
    )
    .map(({ coordinateId: _coordinateId, kind: _kind, ...record }) => record);
  return summarizeEventEvidence(records, now);
}

function deploymentEvidence(
  coordinate: ComponentCoordinate,
  observations: StoredObservation[],
  now: Date,
): EvidenceSummary {
  if (!coordinate.deploymentApplicable) return notTrackedEvidence();
  return coordinateEvidence(coordinate, observations, "deployment", now);
}

function latestServiceObservation(
  probe: ServiceProbe,
  observations: ServiceObservation[],
): ServiceObservation | null {
  return (
    observations
      .filter((observation) => observation.probeId === probe.id)
      .sort(
        (left, right) =>
          timestampValue(right.observedAt) - timestampValue(left.observedAt),
      )[0] ?? null
  );
}

function serviceSummary(
  probe: ServiceProbe,
  observations: ServiceObservation[],
  now: Date,
): ServiceSummary {
  const latest = latestServiceObservation(probe, observations);
  if (!latest) {
    return {
      ...probe,
      surface: "service",
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
    surface: "service",
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

function listingFormatSummary(
  probe: ServiceProbe,
  observations: ServiceObservation[],
  now: Date,
): ListingFormatSummary {
  const format = probe.format;
  if (!format) {
    throw new Error(`Listing probe ${probe.id} is missing a format`);
  }
  const latest = latestServiceObservation(probe, observations);
  if (!latest) {
    return {
      format,
      label: LISTING_FORMAT_LABELS[format],
      url: probe.url,
      status: "unknown",
      lastObservedStatus: null,
      observedAt: null,
      ageSeconds: null,
      stale: false,
      statusCode: null,
      responseMs: null,
      generation: null,
      entryCount: null,
      parityKey: null,
      error: null,
    };
  }

  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - timestampValue(latest.observedAt)) / 1000),
  );
  const stale = ageSeconds > probe.staleAfterSeconds;
  return {
    format,
    label: LISTING_FORMAT_LABELS[format],
    url: probe.url,
    status: stale ? "stale" : latest.status,
    lastObservedStatus: latest.status,
    observedAt: latest.observedAt,
    ageSeconds,
    stale,
    statusCode: latest.statusCode,
    responseMs: latest.responseMs,
    generation: latest.generation,
    entryCount: latest.entryCount,
    parityKey: latest.parityKey,
    error: latest.error,
  };
}

function listingSurfaceStatus(
  formats: ListingFormatSummary[],
  crossFormatSkew: boolean,
): DisplayStatus {
  const statuses = formats.map((format) => format.status);
  if (statuses.some((status) => status === "failed" || status === "cancelled")) {
    return "failed";
  }
  if (statuses.some((status) => status === "stale")) return "stale";
  if (statuses.every((status) => status === "passed") && !crossFormatSkew) {
    return "passed";
  }
  if (statuses.every((status) => status === "unknown")) return "unknown";
  if (statuses.every((status) => status === "running")) return "running";
  return "attention";
}

function latestListingFormat(
  formats: ListingFormatSummary[],
): ListingFormatSummary | null {
  return (
    [...formats]
      .filter((format) => format.observedAt)
      .sort(
        (left, right) =>
          timestampValue(right.observedAt ?? "") -
          timestampValue(left.observedAt ?? ""),
      )[0] ?? null
  );
}

function uniqueValue<T>(values: Array<T | null>): T | null {
  const unique = [...new Set(values.filter((value): value is T => value !== null))];
  return unique.length === 1 ? (unique[0] ?? null) : null;
}

function listingSurfaceSummary(
  probes: ServiceProbe[],
  observations: ServiceObservation[],
  now: Date,
): ListingsSurfaceSummary {
  const formats = LISTING_FORMATS.map((format) => {
    const probe = probes.find(
      (candidate) => candidate.surface === "listings" && candidate.format === format,
    );
    if (!probe) {
      return {
        format,
        label: LISTING_FORMAT_LABELS[format],
        url: "",
        status: "unknown" as const,
        lastObservedStatus: null,
        observedAt: null,
        ageSeconds: null,
        stale: false,
        statusCode: null,
        responseMs: null,
        generation: null,
        entryCount: null,
        parityKey: null,
        error: "No configured probe for this listing format.",
      } satisfies ListingFormatSummary;
    }
    return listingFormatSummary(probe, observations, now);
  });
  const generations = [
    ...new Set(
      formats
        .map((format) => format.generation)
        .filter((value): value is string => value !== null),
    ),
  ];
  const entryCounts = [
    ...new Set(
      formats
        .map((format) => format.entryCount)
        .filter((value): value is number => value !== null),
    ),
  ];
  const crossFormatSkew = generations.length > 1 || entryCounts.length > 1;
  const latest = latestListingFormat(formats);
  const passedFormats = formats.filter((format) => format.status === "passed").length;

  return {
    id: "listings",
    name: "Listings",
    status: listingSurfaceStatus(formats, crossFormatSkew),
    observedAt: latest?.observedAt ?? null,
    ageSeconds: latest?.ageSeconds ?? null,
    stale: latest?.stale ?? false,
    requiredFormats: [...LISTING_FORMATS],
    availableFormats: passedFormats,
    generation: uniqueValue(formats.map((format) => format.generation)),
    entryCount: uniqueValue(formats.map((format) => format.entryCount)),
    crossFormatSkew,
    evidenceUrl: latest?.url || METASERVER_LISTING_EVIDENCE_URL,
    formats,
  };
}

function rendezvousCanarySummary(
  canary: RendezvousHealthObservation["canary"],
): RendezvousSurfaceSummary["canary"] {
  return {
    type: canary.type,
    route: canary.route,
    authenticatedControl: canary.authenticatedControl,
    recentAdmission: canary.recentAdmission,
    observedAt:
      canary.observedAt === null
        ? null
        : new Date(canary.observedAt * 1_000).toISOString(),
  };
}

function rendezvousSignalStatus(
  signal: "not_observed" | "reachable" | "passed" | "failed",
  stale: boolean,
): DisplayStatus {
  if (signal === "not_observed") return "unknown";
  if (stale) return "stale";
  return signal === "reachable" || signal === "passed" ? "passed" : "failed";
}

function rendezvousErrorMessage(
  observation: RendezvousHealthObservation,
  status: DisplayStatus,
): string | null {
  if (observation.error === "source_not_configured") {
    return "Private rendezvous health source is not configured.";
  }
  if (observation.error === "source_unauthorized") {
    return "Private rendezvous health source rejected authorization.";
  }
  if (observation.error === "source_unavailable") {
    return "Private rendezvous health source is unavailable.";
  }
  if (observation.error === "source_invalid_headers") {
    return "Private rendezvous health source returned invalid response headers.";
  }
  if (observation.error === "source_invalid_payload") {
    return "Private rendezvous health source returned an invalid payload.";
  }
  if (observation.error === "malformed_source") {
    return "Private rendezvous health source returned malformed data.";
  }
  if (status === "stale") return "The operator-safe rendezvous source is stale.";
  if (status === "failed")
    return "The operator-safe rendezvous canary reported failure.";
  if (status === "unknown") {
    return "No positive rendezvous health evidence is available.";
  }
  return null;
}

function emptyRendezvousSurface(
  probe: ServiceProbe | undefined,
): RendezvousSurfaceSummary {
  return {
    id: "rendezvous",
    name: "Rendezvous rooms",
    status: "unknown",
    observedAt: null,
    ageSeconds: null,
    stale: false,
    freshness: {
      state: "no_observation",
      ageSeconds: null,
      maximumAgeSeconds: RENDEZVOUS_HEALTH_FRESHNESS_SECONDS,
    },
    routeStatus: "unknown",
    controlsStatus: "unknown",
    admissionStatus: "unknown",
    observationSource: null,
    safeObservationAvailable: false,
    recentAuthenticatedAdmissions: 0,
    recentSessions: emptyRendezvousHealthSessions(),
    canary: {
      type: "none",
      route: "not_observed",
      authenticatedControl: "not_observed",
      recentAdmission: "not_observed",
      observedAt: null,
    },
    reason: "no_observation",
    evidenceUrl: probe?.evidenceUrl ?? METASERVER_RENDEZVOUS_EVIDENCE_URL,
    error:
      "No safe rendezvous health observation is available; private rooms, server IDs, and tokens are not enumerated.",
  };
}

function rendezvousSurfaceSummary(
  probes: ServiceProbe[],
  observations: RendezvousHealthObservation[],
  now: Date,
): RendezvousSurfaceSummary {
  const probe = probes.find((candidate) => candidate.surface === "rendezvous");
  const latest = [...observations].sort(
    (left, right) => timestampValue(right.receivedAt) - timestampValue(left.receivedAt),
  )[0];
  if (!latest) return emptyRendezvousSurface(probe);

  const observation = normalizeStoredRendezvousHealthObservation(
    latest,
    Math.floor(now.getTime() / 1_000),
  );
  if (!observation) {
    return {
      ...emptyRendezvousSurface(probe),
      reason: "malformed_observation",
      error: "Stored rendezvous health observation is malformed.",
    };
  }
  if (observation.error !== null) {
    return {
      ...emptyRendezvousSurface(probe),
      reason: null,
      error: rendezvousErrorMessage(observation, "unknown"),
    };
  }

  const ageSeconds =
    observation.sourceTimestamp === null
      ? null
      : Math.max(
          0,
          Math.floor((now.getTime() - observation.sourceTimestamp * 1_000) / 1_000),
        );
  const stale =
    observation.sourceStatus === "stale" ||
    observation.freshnessState === "stale" ||
    (ageSeconds !== null && ageSeconds > RENDEZVOUS_HEALTH_FRESHNESS_SECONDS);
  const status: DisplayStatus = stale
    ? "stale"
    : observation.sourceStatus === "healthy"
      ? "passed"
      : observation.sourceStatus === "failed"
        ? "failed"
        : "unknown";
  const routeStatus = rendezvousSignalStatus(observation.canary.route, stale);
  const controlsStatus = rendezvousSignalStatus(
    observation.canary.authenticatedControl,
    stale,
  );
  const admissionSignal =
    observation.canary.recentAdmission !== "not_observed"
      ? observation.canary.recentAdmission
      : observation.recentAuthenticatedAdmissions > 0 ||
          observation.recentSessions.outcomes.completed > 0
        ? "passed"
        : "not_observed";
  const admissionStatus = rendezvousSignalStatus(admissionSignal, stale);
  const observedAt =
    observation.sourceTimestamp === null
      ? null
      : new Date(observation.sourceTimestamp * 1_000).toISOString();
  const freshnessState = stale ? "stale" : observation.freshnessState;
  const sourceStatus = status;

  return {
    id: "rendezvous",
    name: "Rendezvous rooms",
    status,
    observedAt,
    ageSeconds,
    stale,
    freshness: {
      state: freshnessState,
      ageSeconds,
      maximumAgeSeconds: RENDEZVOUS_HEALTH_FRESHNESS_SECONDS,
    },
    routeStatus,
    controlsStatus,
    admissionStatus,
    observationSource: RENDEZVOUS_OBSERVATION_SOURCE,
    safeObservationAvailable: true,
    recentAuthenticatedAdmissions: observation.recentAuthenticatedAdmissions,
    recentSessions: {
      total: observation.recentSessions.total,
      outcomes: { ...observation.recentSessions.outcomes },
    },
    canary: rendezvousCanarySummary(observation.canary),
    reason: observation.reason,
    evidenceUrl: probe?.evidenceUrl ?? METASERVER_RENDEZVOUS_EVIDENCE_URL,
    error: rendezvousErrorMessage(observation, sourceStatus),
  };
}

function metaserverSummary(
  probes: ServiceProbe[],
  observations: ServiceObservation[],
  rendezvousObservations: RendezvousHealthObservation[],
  now: Date,
): MetaserverServiceSummary {
  const base =
    probes.find((probe) => probe.id === "metaserver") ??
    SERVICE_PROBES.find((probe) => probe.id === "metaserver");
  const listings = listingSurfaceSummary(probes, observations, now);
  const rendezvous = rendezvousSurfaceSummary(probes, rendezvousObservations, now);
  const latest = latestListingFormat(listings.formats);
  const status = worstStatus([listings.status, rendezvous.status]);

  return {
    id: "metaserver",
    name: "Atrinik metaserver",
    url: base?.url ?? "https://classic.meta.atrinik.org/index.html",
    stack: base?.stack ?? "default",
    staleAfterSeconds: base?.staleAfterSeconds ?? 1800,
    surface: "metaserver",
    format: null,
    evidenceUrl: listings.evidenceUrl,
    status,
    lastObservedStatus: latest?.lastObservedStatus ?? null,
    observedAt: latest?.observedAt ?? null,
    ageSeconds: latest?.ageSeconds ?? null,
    stale: status === "stale",
    statusCode: latest?.statusCode ?? null,
    responseMs: latest?.responseMs ?? null,
    error: status === rendezvous.status ? rendezvous.error : (latest?.error ?? null),
    surfaces: { listings, rendezvous },
  };
}

function aggregateServices(
  probes: ServiceProbe[],
  observations: ServiceObservation[],
  rendezvousObservations: RendezvousHealthObservation[],
  now: Date,
): DashboardService[] {
  const services: DashboardService[] = probes
    .filter((probe) => probe.surface === "service")
    .map((probe) => serviceSummary(probe, observations, now));
  const hasMetaserver = probes.some((probe) => probe.surface !== "service");
  if (!hasMetaserver) return services;

  const configured = new Map(probes.map((probe) => [probe.id, probe]));
  const expected = SERVICE_PROBES.filter((probe) => probe.surface !== "service");
  const metaserverProbes = expected.map((probe) => configured.get(probe.id) ?? probe);
  return [
    ...services,
    metaserverSummary(metaserverProbes, observations, rendezvousObservations, now),
  ];
}

export function aggregateDashboard(
  coordinates: ComponentCoordinate[],
  observations: StoredObservation[],
  probes: ServiceProbe[],
  serviceObservations: ServiceObservation[],
  now: Date,
  staleAfterSeconds: number,
  rendezvousObservations: RendezvousHealthObservation[] = [],
): DashboardStatus {
  const dashboardCoordinates = coordinates.map((coordinate) => {
    const dashboardCoordinate: DashboardCoordinate = {
      ...coordinate,
      overall: "unknown",
      build: coordinateEvidence(coordinate, observations, "build", now),
      release: coordinateEvidence(coordinate, observations, "release", now),
      package: coordinateEvidence(coordinate, observations, "package", now),
      deployment: deploymentEvidence(coordinate, observations, now),
    };
    dashboardCoordinate.overall = coordinateOverall(dashboardCoordinate);
    return dashboardCoordinate;
  });

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    staleAfterSeconds,
    coordinates: dashboardCoordinates,
    services: aggregateServices(
      probes,
      serviceObservations,
      rendezvousObservations,
      now,
    ),
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
