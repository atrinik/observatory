import type { NormalizedObservation, ObservationStatus } from "./types";

type JsonRecord = Record<string, unknown>;

export interface GitHubEventInput {
  eventName: string;
  deliveryId: string;
  payload: unknown;
  receivedAt: string;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nested(record: JsonRecord, key: string): JsonRecord {
  return asRecord(record[key]);
}

function firstString(record: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function repositoryName(payload: JsonRecord): string | null {
  const repository = nested(payload, "repository");
  const fullName = stringValue(repository.full_name);
  if (fullName) return fullName;
  const owner = nested(repository, "owner");
  const ownerName = firstString(owner, ["login", "name"]);
  const name = stringValue(repository.name);
  return ownerName && name ? `${ownerName}/${name}` : null;
}

function eventDate(payload: JsonRecord, candidates: string[], fallback: string) {
  const value = firstString(payload, candidates);
  if (value && !Number.isNaN(Date.parse(value))) return value;
  return fallback;
}

function conclusionStatus(conclusion: string | null): ObservationStatus {
  switch (conclusion) {
    case "success":
      return "passed";
    case "failure":
    case "timed_out":
    case "action_required":
    case "startup_failure":
      return "failed";
    case "cancelled":
    case "stale":
      return "cancelled";
    default:
      return "unknown";
  }
}

function activeStatus(
  status: string | null,
  conclusion: string | null,
): ObservationStatus {
  if (conclusion) return conclusionStatus(conclusion);
  if (status === "queued" || status === "in_progress") return "running";
  return "unknown";
}

function baseObservation(
  repository: string,
  kind: NormalizedObservation["kind"],
  payload: JsonRecord,
  occurredAt: string,
  status: ObservationStatus,
): NormalizedObservation {
  return {
    repository,
    kind,
    status,
    occurredAt,
    ref: firstString(payload, ["head_branch", "ref", "target_commitish"]),
    commitSha: firstString(payload, ["head_sha", "sha"]),
    title: firstString(payload, ["name", "run_name", "display_title"]) ?? kind,
    sourceUrl: firstString(payload, [
      "html_url",
      "details_url",
      "workflow_url",
      "target_url",
      "environment_url",
    ]),
    workflowName: firstString(payload, ["name", "workflow_name", "run_name"]),
    releaseTag: firstString(payload, ["tag_name"]),
    packageUrl: null,
    artifactUrl: null,
  };
}

function normalizeWorkflowRun(
  repository: string,
  payload: JsonRecord,
  receivedAt: string,
): NormalizedObservation {
  const run = nested(payload, "workflow_run");
  const observation = baseObservation(
    repository,
    "build",
    run,
    eventDate(run, ["updated_at", "completed_at", "created_at"], receivedAt),
    activeStatus(stringValue(run.status), stringValue(run.conclusion)),
  );
  observation.title =
    firstString(run, ["name", "run_name", "display_title"]) ?? "Workflow run";
  return observation;
}

function normalizeWorkflowJob(
  repository: string,
  payload: JsonRecord,
  receivedAt: string,
): NormalizedObservation {
  const job = nested(payload, "workflow_job");
  return baseObservation(
    repository,
    "build",
    job,
    eventDate(job, ["completed_at", "started_at", "created_at"], receivedAt),
    activeStatus(stringValue(job.status), stringValue(job.conclusion)),
  );
}

function normalizeCheckRun(
  repository: string,
  payload: JsonRecord,
  receivedAt: string,
): NormalizedObservation {
  const check = nested(payload, "check_run");
  const suite = nested(check, "check_suite");
  const observation = baseObservation(
    repository,
    "build",
    check,
    eventDate(
      check,
      ["completed_at", "started_at"],
      eventDate(suite, ["completed_at", "started_at"], receivedAt),
    ),
    activeStatus(stringValue(check.status), stringValue(check.conclusion)),
  );
  observation.ref =
    firstString(check, ["head_branch", "ref"]) ??
    firstString(suite, ["head_branch", "ref"]);
  observation.commitSha =
    firstString(check, ["head_sha"]) ?? firstString(suite, ["head_sha"]);
  observation.workflowName =
    firstString(check, ["name", "workflow_name"]) ??
    firstString(suite, ["workflow_name", "name"]);
  return observation;
}

function normalizeRelease(
  repository: string,
  payload: JsonRecord,
  receivedAt: string,
): NormalizedObservation[] {
  const release = nested(payload, "release");
  const action = stringValue(payload.action);
  const releaseStatus: ObservationStatus =
    action === "deleted"
      ? "cancelled"
      : action === "published" || action === "released" || action === "created"
        ? "passed"
        : "unknown";
  const releaseObservation = baseObservation(
    repository,
    "release",
    release,
    eventDate(release, ["published_at", "created_at", "updated_at"], receivedAt),
    releaseStatus,
  );
  releaseObservation.title =
    firstString(release, ["name", "tag_name"]) ?? "GitHub release";

  const assets = Array.isArray(release.assets)
    ? release.assets
        .map((asset) => stringValue(asRecord(asset).browser_download_url))
        .filter((url): url is string => url !== null)
    : [];
  const packageUrl = assets[0] ?? firstString(release, ["tarball_url", "zipball_url"]);
  const packageObservation = baseObservation(
    repository,
    "package",
    release,
    eventDate(release, ["published_at", "created_at", "updated_at"], receivedAt),
    packageUrl ? releaseStatus : "unknown",
  );
  packageObservation.title = `${releaseObservation.title} package evidence`;
  packageObservation.packageUrl = packageUrl;
  packageObservation.artifactUrl = assets[0] ?? null;
  packageObservation.releaseTag = releaseObservation.releaseTag;

  return [releaseObservation, packageObservation];
}

function normalizeDeploymentStatus(
  repository: string,
  payload: JsonRecord,
  receivedAt: string,
): NormalizedObservation {
  const deployment = nested(payload, "deployment");
  const status = nested(payload, "deployment_status");
  const state = stringValue(status.state);
  const observation = baseObservation(
    repository,
    "deployment",
    status,
    eventDate(status, ["created_at", "updated_at"], receivedAt),
    state === "success"
      ? "passed"
      : state === "failure" || state === "error"
        ? "failed"
        : state === "inactive"
          ? "cancelled"
          : state === "queued" || state === "in_progress" || state === "pending"
            ? "running"
            : "unknown",
  );
  observation.ref = firstString(deployment, ["ref"]) ?? observation.ref;
  observation.commitSha = firstString(deployment, ["sha"]) ?? observation.commitSha;
  observation.title =
    firstString(status, ["environment", "description"]) ?? "Deployment";
  return observation;
}

export function normalizeGitHubEvent({
  eventName,
  payload: unknownPayload,
  receivedAt,
}: GitHubEventInput): NormalizedObservation[] {
  const payload = asRecord(unknownPayload);
  const repository = repositoryName(payload);
  if (!repository) return [];

  switch (eventName) {
    case "workflow_run":
      return [normalizeWorkflowRun(repository, payload, receivedAt)];
    case "workflow_job":
      return [normalizeWorkflowJob(repository, payload, receivedAt)];
    case "check_run":
      return [normalizeCheckRun(repository, payload, receivedAt)];
    case "release":
      return normalizeRelease(repository, payload, receivedAt);
    case "deployment_status":
      return [normalizeDeploymentStatus(repository, payload, receivedAt)];
    default:
      return [];
  }
}
