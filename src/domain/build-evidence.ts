type JsonRecord = Record<string, unknown>;

const BUILD_REF_KEYS = ["head_branch", "head_ref", "ref", "target_commitish"] as const;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function repositoryName(value: unknown): string | null {
  const repository = asRecord(value);
  if (!repository) return null;
  const fullName = stringValue(repository.full_name);
  if (fullName) return fullName;
  const owner = asRecord(repository.owner);
  const ownerName = owner
    ? (stringValue(owner.login) ?? stringValue(owner.name))
    : null;
  const name = stringValue(repository.name);
  return ownerName && name ? `${ownerName}/${name}` : null;
}

function hasPullRequestAssociation(source: JsonRecord): boolean {
  if (!("pull_requests" in source)) return false;
  const pullRequests = source.pull_requests;
  return !Array.isArray(pullRequests) || pullRequests.length > 0;
}

function hasForkedHead(source: JsonRecord, repository: string): boolean {
  if (!("head_repository" in source)) return false;
  const headRepository = source.head_repository;
  if (headRepository === null || headRepository === undefined) return false;

  const record = asRecord(headRepository);
  if (!record) return true;
  if ("fork" in record && typeof record.fork !== "boolean") return true;
  if (record.fork === true) return true;

  const headName = repositoryName(record);
  return headName !== null && headName.toLowerCase() !== repository.toLowerCase();
}

function sourceRefs(source: JsonRecord): { values: string[]; invalid: boolean } {
  const values: string[] = [];
  let invalid = false;
  for (const key of BUILD_REF_KEYS) {
    if (!(key in source)) continue;
    const value = source[key];
    if (value === null || value === undefined) continue;
    const string = stringValue(value);
    if (string === null) {
      invalid = true;
    } else {
      values.push(string);
    }
  }
  return { values, invalid };
}

export function isMainBuildRef(ref: string | null): boolean {
  return ref === "main" || ref === "refs/heads/main";
}

/**
 * Return the source ref only when every available build signal proves main.
 * Missing, conflicting, PR-associated, and fork-associated provenance is not
 * evidence of the production branch.
 */
export function trustedMainBuildRef(
  sources: readonly JsonRecord[],
  repository: string,
): string | null {
  const refs: string[] = [];
  for (const source of sources) {
    if (hasPullRequestAssociation(source) || hasForkedHead(source, repository)) {
      return null;
    }
    const sourceResult = sourceRefs(source);
    if (sourceResult.invalid) return null;
    refs.push(...sourceResult.values);
  }

  if (refs.length === 0 || !refs.every(isMainBuildRef)) return null;
  return refs[0] ?? null;
}

export function isPersistableEvidence(observation: {
  kind: string;
  ref: string | null;
}): boolean {
  return observation.kind !== "build" || isMainBuildRef(observation.ref);
}
