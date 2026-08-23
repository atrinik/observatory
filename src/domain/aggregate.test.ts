import { describe, expect, it } from "vitest";
import { aggregateDashboard } from "./aggregate";
import type { ComponentCoordinate } from "./types";

const coordinate: ComponentCoordinate = {
  id: "default:observatory",
  repository: "atrinik/observatory",
  component: "observatory",
  stack: "default",
  generation: "replacement",
};

const record = (
  overrides: Partial<Parameters<typeof aggregateDashboard>[1][number]>,
) => ({
  id: "record",
  coordinateId: coordinate.id,
  kind: "build" as const,
  status: "passed" as const,
  observedAt: "2026-08-23T11:00:00.000Z",
  receivedAt: "2026-08-23T11:00:01.000Z",
  ref: "main",
  commitSha: "abc",
  title: "Validate",
  sourceUrl: "https://github.com/atrinik/observatory/actions/runs/1",
  workflowName: "Validate",
  releaseTag: null,
  packageUrl: null,
  artifactUrl: null,
  ...overrides,
});

describe("aggregateDashboard", () => {
  it("uses event time, not insertion order, and retains the last known good", () => {
    const dashboard = aggregateDashboard(
      [coordinate],
      [
        record({
          id: "newer-failure",
          status: "failed",
          observedAt: "2026-08-23T12:00:00.000Z",
        }),
        record({
          id: "older-pass",
          observedAt: "2026-08-23T10:00:00.000Z",
        }),
      ],
      [],
      [],
      new Date("2026-08-23T12:05:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]?.build.status).toBe("failed");
    expect(dashboard.coordinates[0]?.build.lastKnownGood?.id).toBe("older-pass");
    expect(dashboard.coordinates[0]?.build.mostRecentFailure?.id).toBe("newer-failure");
    expect(dashboard.summary.attention).toBe(1);
  });

  it("lets a newer pass clear an active failure while retaining failure history", () => {
    const dashboard = aggregateDashboard(
      [coordinate],
      [
        record({
          id: "recovered-pass",
          observedAt: "2026-08-23T12:00:00.000Z",
        }),
        record({
          id: "older-failure",
          status: "failed",
          observedAt: "2026-08-23T11:00:00.000Z",
        }),
      ],
      [],
      [],
      new Date("2026-08-23T12:05:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]?.build.status).toBe("passed");
    expect(dashboard.coordinates[0]?.build.mostRecentFailure?.id).toBe("older-failure");
    expect(dashboard.summary.healthy).toBe(0);
    expect(dashboard.summary.unknown).toBe(1);
  });

  it("marks old observations stale instead of healthy", () => {
    const dashboard = aggregateDashboard(
      [coordinate],
      [record({ observedAt: "2026-08-22T00:00:00.000Z" })],
      [],
      [],
      new Date("2026-08-23T00:00:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]?.build.status).toBe("stale");
    expect(dashboard.summary.stale).toBe(1);
    expect(dashboard.summary.healthy).toBe(0);
  });

  it("does not turn missing release or package records into passes", () => {
    const dashboard = aggregateDashboard(
      [coordinate],
      [record({})],
      [],
      [],
      new Date("2026-08-23T12:00:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]?.build.status).toBe("passed");
    expect(dashboard.coordinates[0]?.release.status).toBe("unknown");
    expect(dashboard.coordinates[0]?.package.status).toBe("unknown");
    expect(dashboard.coordinates[0]?.overall).toBe("unknown");
  });
});
