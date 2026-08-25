import { describe, expect, it } from "vitest";
import { normalizeGitHubEvent } from "./events";

const receivedAt = "2026-08-23T12:00:00.000Z";

type BuildEventName = "workflow_run" | "workflow_job" | "check_run";

function buildPayload(
  eventName: BuildEventName,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const event = {
    name: "Provider build",
    status: "completed",
    conclusion: "failure",
    head_sha: "build-sha",
    html_url: "https://github.com/atrinik/observatory/checks/1",
    ...source,
  };
  return {
    repository: { full_name: "atrinik/observatory" },
    [eventName]: event,
  };
}

function normalizeBuild(eventName: BuildEventName, source: Record<string, unknown>) {
  return normalizeGitHubEvent({
    eventName,
    deliveryId: `${eventName}-delivery`,
    receivedAt,
    payload: buildPayload(eventName, source),
  });
}

describe("normalizeGitHubEvent", () => {
  it("normalizes a completed workflow without inventing release evidence", () => {
    const [observation] = normalizeGitHubEvent({
      eventName: "workflow_run",
      deliveryId: "delivery-1",
      receivedAt,
      payload: {
        action: "completed",
        repository: { full_name: "atrinik/observatory" },
        workflow_run: {
          name: "Validate",
          status: "completed",
          conclusion: "success",
          head_branch: "main",
          head_sha: "abc123",
          updated_at: "2026-08-23T11:59:00.000Z",
          html_url: "https://github.com/atrinik/observatory/actions/runs/1",
        },
      },
    });

    expect(observation).toMatchObject({
      repository: "atrinik/observatory",
      kind: "build",
      status: "passed",
      ref: "main",
      commitSha: "abc123",
      sourceUrl: "https://github.com/atrinik/observatory/actions/runs/1",
    });
  });

  it("keeps release and package evidence separate", () => {
    const observations = normalizeGitHubEvent({
      eventName: "release",
      deliveryId: "delivery-2",
      receivedAt,
      payload: {
        action: "published",
        repository: { full_name: "atrinik/website" },
        release: {
          name: "v1.2.3",
          tag_name: "v1.2.3",
          published_at: receivedAt,
          html_url: "https://github.com/atrinik/website/releases/tag/v1.2.3",
          assets: [],
        },
      },
    });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ kind: "release", status: "passed" });
    expect(observations[1]).toMatchObject({ kind: "package", status: "unknown" });
  });

  it("preserves a failed deployment as actionable evidence", () => {
    const [observation] = normalizeGitHubEvent({
      eventName: "deployment_status",
      deliveryId: "delivery-3",
      receivedAt,
      payload: {
        repository: { full_name: "atrinik/website" },
        deployment: { ref: "main", sha: "def456" },
        deployment_status: {
          state: "failure",
          environment: "production",
          created_at: receivedAt,
          target_url: "https://github.com/atrinik/website/deployments/1",
        },
      },
    });

    expect(observation).toMatchObject({
      kind: "deployment",
      status: "failed",
      ref: "main",
      commitSha: "def456",
      sourceUrl: "https://github.com/atrinik/website/deployments/1",
    });
  });

  it("keeps check-run suite ref, commit, and timing evidence", () => {
    const [observation] = normalizeGitHubEvent({
      eventName: "check_run",
      deliveryId: "delivery-4",
      receivedAt,
      payload: {
        repository: { full_name: "atrinik/server" },
        check_run: {
          name: "Integration",
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/atrinik/server/runs/4",
          check_suite: {
            head_branch: "main",
            head_sha: "fedcba",
            completed_at: "2026-08-23T11:58:00.000Z",
          },
        },
      },
    });

    expect(observation).toMatchObject({
      kind: "build",
      status: "failed",
      ref: "main",
      commitSha: "fedcba",
      occurredAt: "2026-08-23T11:58:00.000Z",
    });
  });

  it.each([
    ["workflow_run", { head_branch: "main" }],
    ["workflow_job", { head_branch: "refs/heads/main" }],
    ["check_run", { check_suite: { head_branch: "main" } }],
  ] as const)(
    "accepts %s evidence for the canonical main branch",
    (eventName, source) => {
      const [observation] = normalizeBuild(eventName, source);

      expect(observation).toMatchObject({ kind: "build" });
      expect(
        observation?.ref === "main" || observation?.ref === "refs/heads/main",
      ).toBe(true);
    },
  );

  it.each(["workflow_run", "workflow_job", "check_run"] as const)(
    "ignores %s evidence from a feature branch",
    (eventName) => {
      expect(normalizeBuild(eventName, { head_branch: "feature/status" })).toEqual([]);
    },
  );

  it.each(["workflow_run", "workflow_job", "check_run"] as const)(
    "ignores %s evidence from a pull-request ref",
    (eventName) => {
      expect(normalizeBuild(eventName, { ref: "refs/pull/23/head" })).toEqual([]);
    },
  );

  it.each(["workflow_run", "workflow_job", "check_run"] as const)(
    "ignores %s evidence when the branch cannot be established",
    (eventName) => {
      expect(normalizeBuild(eventName, {})).toEqual([]);
    },
  );

  it.each(["workflow_run", "workflow_job", "check_run"] as const)(
    "ignores %s evidence when branch representations disagree",
    (eventName) => {
      const source =
        eventName === "check_run"
          ? { head_branch: "main", check_suite: { head_branch: "feature/status" } }
          : { head_branch: "main", ref: "feature/status" };

      expect(normalizeBuild(eventName, source)).toEqual([]);
    },
  );

  it("ignores a failed provider check associated with a pull request", () => {
    expect(
      normalizeBuild("check_run", {
        name: "Cloudflare Pages",
        head_branch: "main",
        pull_requests: [{ url: "https://github.com/atrinik/observatory/pull/23" }],
        app: { slug: "cloudflare-pages" },
      }),
    ).toEqual([]);
  });

  it("ignores a main-labeled build whose head repository is a fork", () => {
    expect(
      normalizeBuild("workflow_run", {
        head_branch: "main",
        head_repository: {
          full_name: "contributor/observatory",
          fork: true,
        },
      }),
    ).toEqual([]);
  });
});
