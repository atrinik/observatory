import { describe, expect, it } from "vitest";
import { aggregateDashboard } from "./aggregate";
import { SERVICE_PROBES } from "./components";
import type { ComponentCoordinate, ServiceObservation } from "./types";

const coordinate: ComponentCoordinate = {
  id: "default:observatory",
  repository: "atrinik/observatory",
  component: "observatory",
  stack: "default",
  generation: "replacement",
  deploymentApplicable: true,
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

  it("does not penalize a coordinate without a deployment surface", () => {
    const nonDeployableCoordinate: ComponentCoordinate = {
      ...coordinate,
      id: "default:resources",
      repository: "atrinik/resources",
      component: "resources",
      deploymentApplicable: false,
    };
    const dashboard = aggregateDashboard(
      [nonDeployableCoordinate],
      [
        record({
          id: "resources-build",
          coordinateId: nonDeployableCoordinate.id,
          kind: "build",
        }),
        record({
          id: "resources-release",
          coordinateId: nonDeployableCoordinate.id,
          kind: "release",
        }),
        record({
          id: "resources-package",
          coordinateId: nonDeployableCoordinate.id,
          kind: "package",
        }),
      ],
      [],
      [],
      new Date("2026-08-23T12:00:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]?.deployment.status).toBe("not-tracked");
    expect(dashboard.coordinates[0]?.overall).toBe("passed");
    expect(dashboard.summary.healthy).toBe(1);
    expect(dashboard.summary.unknown).toBe(0);
  });

  it("keeps an applicable coordinate unknown when deployment evidence is missing", () => {
    const dashboard = aggregateDashboard(
      [coordinate],
      [
        record({ id: "build-pass", kind: "build" }),
        record({ id: "release-pass", kind: "release" }),
        record({ id: "package-pass", kind: "package" }),
      ],
      [],
      [],
      new Date("2026-08-23T12:00:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]?.deployment.status).toBe("unknown");
    expect(dashboard.coordinates[0]?.overall).toBe("unknown");
    expect(dashboard.summary.healthy).toBe(0);
    expect(dashboard.summary.unknown).toBe(1);
  });

  it("applies the same non-tracked semantics to both shared stack views", () => {
    const sharedCoordinates: ComponentCoordinate[] = [
      {
        ...coordinate,
        id: "default:resources",
        repository: "atrinik/resources",
        component: "resources",
        deploymentApplicable: false,
      },
      {
        ...coordinate,
        id: "classic:resources",
        repository: "atrinik/resources",
        component: "resources",
        stack: "classic",
        generation: "shared",
        deploymentApplicable: false,
      },
    ];
    const observations = sharedCoordinates.flatMap((sharedCoordinate) =>
      ["build", "release", "package"].map((kind) =>
        record({
          id: `${sharedCoordinate.id}:${kind}`,
          coordinateId: sharedCoordinate.id,
          kind: kind as "build" | "release" | "package",
        }),
      ),
    );
    const dashboard = aggregateDashboard(
      sharedCoordinates,
      observations,
      [],
      [],
      new Date("2026-08-23T12:00:00.000Z"),
      21600,
    );

    expect(
      dashboard.coordinates.map((sharedCoordinate) => [
        sharedCoordinate.id,
        sharedCoordinate.deployment.status,
        sharedCoordinate.overall,
      ]),
    ).toEqual([
      ["default:resources", "not-tracked", "passed"],
      ["classic:resources", "not-tracked", "passed"],
    ]);
    expect(dashboard.summary).toMatchObject({ total: 2, healthy: 2, unknown: 0 });
  });
});

describe("metaserver surfaces", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const listingProbes = SERVICE_PROBES.filter((probe) => probe.surface === "listings");

  const listingObservation = (
    probeId: string,
    overrides: Partial<ServiceObservation> = {},
  ): ServiceObservation => ({
    id: `${probeId}:observation`,
    probeId,
    status: "passed",
    observedAt: "2026-08-23T11:59:00.000Z",
    statusCode: 200,
    responseMs: 40,
    error: null,
    format: listingProbes.find((probe) => probe.id === probeId)?.format ?? null,
    generation: "directory-42",
    entryCount: 3,
    parityKey: "generation:directory-42;entries:3",
    ...overrides,
  });

  const dashboardFor = (observations: ServiceObservation[]) =>
    aggregateDashboard([], [], SERVICE_PROBES, observations, now, 21600);

  it("keeps healthy listings separate from unknown rendezvous", () => {
    const service = dashboardFor(
      listingProbes.map((probe) => listingObservation(probe.id)),
    ).services.find((candidate) => candidate.id === "metaserver");

    expect(service).toMatchObject({
      status: "unknown",
      surfaces: {
        listings: {
          status: "passed",
          availableFormats: 3,
          crossFormatSkew: false,
        },
        rendezvous: {
          status: "unknown",
          safeObservationAvailable: false,
          observationSource: null,
        },
      },
    });
  });

  it("ignores retained root observations after the root probe is retired", () => {
    const service = dashboardFor([
      ...listingProbes.map((probe) => listingObservation(probe.id)),
      {
        id: "metaserver:listings:root:historical",
        probeId: "metaserver:listings:root",
        status: "failed",
        observedAt: "2026-08-23T11:59:30.000Z",
        statusCode: 404,
        responseMs: 30,
        error: "404 Not Found",
        format: null,
        generation: null,
        entryCount: null,
        parityKey: null,
      },
    ]).services.find((candidate) => candidate.id === "metaserver");

    expect(service).toMatchObject({
      surfaces: {
        listings: {
          status: "passed",
          availableFormats: 3,
          requiredFormats: ["html", "json", "xml"],
          formats: [{ format: "html" }, { format: "json" }, { format: "xml" }],
        },
      },
    });
  });

  it("does not hide failed, stale, or partial listing formats", () => {
    const failed = dashboardFor([
      ...listingProbes
        .filter((probe) => probe.format !== "json")
        .map((probe) => listingObservation(probe.id)),
      listingObservation("metaserver:listings:json", {
        status: "failed",
        statusCode: 503,
        error: "503 unavailable",
      }),
    ]).services.find((candidate) => candidate.id === "metaserver");
    expect(failed).toMatchObject({ surfaces: { listings: { status: "failed" } } });

    const stale = dashboardFor([
      ...listingProbes
        .filter((probe) => probe.format !== "xml")
        .map((probe) => listingObservation(probe.id)),
      listingObservation("metaserver:listings:xml", {
        observedAt: "2026-08-23T10:00:00.000Z",
      }),
    ]).services.find((candidate) => candidate.id === "metaserver");
    expect(stale).toMatchObject({ surfaces: { listings: { status: "stale" } } });

    const partial = dashboardFor(
      listingProbes
        .filter((probe) => probe.format !== "xml")
        .map((probe) => listingObservation(probe.id)),
    ).services.find((candidate) => candidate.id === "metaserver");
    expect(partial).toMatchObject({ surfaces: { listings: { status: "attention" } } });
  });

  it("surfaces cross-format generation skew instead of false-passing", () => {
    const dashboard = dashboardFor(
      listingProbes.map((probe) =>
        listingObservation(probe.id, {
          generation: probe.format === "xml" ? "directory-43" : "directory-42",
          parityKey:
            probe.format === "xml"
              ? "generation:directory-43;entries:3"
              : "generation:directory-42;entries:3",
        }),
      ),
    );
    const service = dashboard.services.find(
      (candidate) => candidate.id === "metaserver",
    );

    expect(service).toMatchObject({
      status: "attention",
      surfaces: { listings: { status: "attention", crossFormatSkew: true } },
    });
  });
});
