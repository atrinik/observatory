export const STACKS = ["default", "classic"] as const;
export type Stack = (typeof STACKS)[number];

export const EVIDENCE_KINDS = [
  "build",
  "release",
  "package",
  "deployment",
  "service",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type CoordinateEvidenceKind = Exclude<EvidenceKind, "service">;

export const OBSERVATION_STATUSES = [
  "passed",
  "failed",
  "cancelled",
  "running",
  "unknown",
] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];
export type DisplayStatus = ObservationStatus | "attention" | "stale" | "not-tracked";

export const LISTING_FORMATS = ["html", "json", "xml"] as const;
export type ListingFormat = (typeof LISTING_FORMATS)[number];

export const SERVICE_SURFACES = ["service", "listings", "rendezvous"] as const;
export type ServiceSurface = (typeof SERVICE_SURFACES)[number];

export type Generation = "replacement" | "classic" | "shared";

export interface ComponentCoordinate {
  id: string;
  repository: string;
  component: string;
  stack: Stack;
  generation: Generation;
  deploymentApplicable: boolean;
}

export interface EvidenceRecord {
  id: string;
  status: ObservationStatus;
  observedAt: string;
  receivedAt: string;
  ref: string | null;
  commitSha: string | null;
  title: string;
  sourceUrl: string | null;
  workflowName: string | null;
  releaseTag: string | null;
  packageUrl: string | null;
  artifactUrl: string | null;
}

export interface EvidenceSummary {
  status: DisplayStatus;
  lastObservedStatus: ObservationStatus | null;
  observedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  latest: EvidenceRecord | null;
  lastKnownGood: EvidenceRecord | null;
  mostRecentFailure: EvidenceRecord | null;
}

export interface DashboardCoordinate extends ComponentCoordinate {
  overall: DisplayStatus;
  build: EvidenceSummary;
  release: EvidenceSummary;
  package: EvidenceSummary;
  deployment: EvidenceSummary;
}

export interface ServiceProbe {
  id: string;
  name: string;
  url: string;
  stack: Stack;
  staleAfterSeconds: number;
  surface: ServiceSurface;
  format: ListingFormat | null;
  evidenceUrl: string | null;
}

export interface ServiceSummary extends ServiceProbe {
  surface: "service";
  status: DisplayStatus;
  lastObservedStatus: ObservationStatus | null;
  observedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
}

export interface ListingFormatSummary {
  format: ListingFormat;
  label: string;
  url: string;
  status: DisplayStatus;
  lastObservedStatus: ObservationStatus | null;
  observedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  statusCode: number | null;
  responseMs: number | null;
  generation: string | null;
  entryCount: number | null;
  parityKey: string | null;
  error: string | null;
}

export interface ListingsSurfaceSummary {
  id: "listings";
  name: "Listings";
  status: DisplayStatus;
  observedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  requiredFormats: ListingFormat[];
  availableFormats: number;
  generation: string | null;
  entryCount: number | null;
  crossFormatSkew: boolean;
  evidenceUrl: string | null;
  formats: ListingFormatSummary[];
}

export interface RendezvousSurfaceSummary {
  id: "rendezvous";
  name: "Rendezvous rooms";
  status: DisplayStatus;
  observedAt: null;
  ageSeconds: null;
  stale: false;
  routeStatus: DisplayStatus;
  controlsStatus: DisplayStatus;
  admissionStatus: DisplayStatus;
  observationSource: string | null;
  safeObservationAvailable: false;
  evidenceUrl: string | null;
  error: string;
}

export interface MetaserverServiceSummary {
  id: "metaserver";
  name: "Atrinik metaserver";
  url: string;
  stack: Stack;
  staleAfterSeconds: number;
  surface: "metaserver";
  format: null;
  evidenceUrl: string | null;
  status: DisplayStatus;
  lastObservedStatus: ObservationStatus | null;
  observedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
  surfaces: {
    listings: ListingsSurfaceSummary;
    rendezvous: RendezvousSurfaceSummary;
  };
}

export type DashboardService = ServiceSummary | MetaserverServiceSummary;

export interface DashboardSummary {
  total: number;
  healthy: number;
  attention: number;
  stale: number;
  unknown: number;
}

export interface DashboardStatus {
  schemaVersion: 1;
  generatedAt: string | null;
  staleAfterSeconds: number;
  coordinates: DashboardCoordinate[];
  services: DashboardService[];
  summary: DashboardSummary;
}

export interface NormalizedObservation {
  repository: string;
  kind: CoordinateEvidenceKind;
  status: ObservationStatus;
  occurredAt: string;
  ref: string | null;
  commitSha: string | null;
  title: string;
  sourceUrl: string | null;
  workflowName: string | null;
  releaseTag: string | null;
  packageUrl: string | null;
  artifactUrl: string | null;
}

export interface ServiceObservation {
  id: string;
  probeId: string;
  status: ObservationStatus;
  observedAt: string;
  statusCode: number | null;
  responseMs: number | null;
  error: string | null;
  format: ListingFormat | null;
  generation: string | null;
  entryCount: number | null;
  parityKey: string | null;
}
