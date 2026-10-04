import { validateClassicRendezvous } from "../../scripts/verify-production.mjs";
import { describe, expect, it } from "vitest";
import { aggregateDashboard } from "./aggregate";
import { SERVICE_PROBES } from "./components";
import type {
  ComponentCoordinate,
  RendezvousHealthObservation,
  ServiceObservation,
} from "./types";

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

  it("excludes retained non-main build rows from every build summary", () => {
    const dashboard = aggregateDashboard(
      [coordinate],
      [
        record({
          id: "main-pass",
          status: "passed",
          observedAt: "2026-08-23T10:00:00.000Z",
          ref: "refs/heads/main",
        }),
        record({
          id: "feature-failure",
          status: "failed",
          observedAt: "2026-08-23T12:00:00.000Z",
          ref: "feature/status",
        }),
        record({
          id: "pull-request-failure",
          status: "failed",
          observedAt: "2026-08-23T13:00:00.000Z",
          ref: "refs/pull/23/head",
        }),
      ],
      [],
      [],
      new Date("2026-08-23T13:05:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]?.build).toMatchObject({
      status: "passed",
      latest: { id: "main-pass" },
      lastKnownGood: { id: "main-pass" },
      mostRecentFailure: null,
    });
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

  it("keeps old event-driven evidence passed while exposing its age", () => {
    const dashboard = aggregateDashboard(
      [coordinate],
      [
        record({ id: "old-build", kind: "build" }),
        record({ id: "old-release", kind: "release" }),
        record({ id: "old-package", kind: "package" }),
        record({ id: "old-deployment", kind: "deployment" }),
      ].map((observation) => ({
        ...observation,
        observedAt: "2026-08-22T00:00:00.000Z",
      })),
      [],
      [],
      new Date("2026-08-23T00:00:00.000Z"),
      21600,
    );

    expect(dashboard.coordinates[0]).toMatchObject({
      overall: "passed",
      build: { status: "passed", stale: false, ageSeconds: 86400 },
      release: { status: "passed", stale: false, ageSeconds: 86400 },
      package: { status: "passed", stale: false, ageSeconds: 86400 },
      deployment: { status: "passed", stale: false, ageSeconds: 86400 },
    });
    expect(dashboard.summary).toMatchObject({
      healthy: 1,
      stale: 0,
      unknown: 0,
    });
  });

  it.each(["failed", "cancelled", "running"] as const)(
    "keeps a newer %s event status ahead of an older pass",
    (status) => {
      const dashboard = aggregateDashboard(
        [coordinate],
        [
          record({
            id: "older-pass",
            observedAt: "2026-08-22T00:00:00.000Z",
          }),
          record({
            id: "newer-" + status,
            status,
            observedAt: "2026-08-23T00:00:00.000Z",
          }),
        ],
        [],
        [],
        new Date("2026-08-24T00:00:00.000Z"),
        21600,
      );

      expect(dashboard.coordinates[0]?.build).toMatchObject({
        status,
        lastObservedStatus: status,
        stale: false,
        ageSeconds: 86400,
      });
      expect(dashboard.coordinates[0]?.overall).toBe(status);
    },
  );

  it("keeps scheduled service freshness independent from event evidence", () => {
    const probe = SERVICE_PROBES.find((candidate) => candidate.surface === "service");
    expect(probe).toBeDefined();
    if (!probe) return;

    const dashboard = aggregateDashboard(
      [],
      [],
      [probe],
      [
        {
          id: "old-service-observation",
          probeId: probe.id,
          status: "passed",
          observedAt: "2026-08-22T00:00:00.000Z",
          statusCode: 200,
          responseMs: 40,
          error: null,
          format: null,
          generation: null,
          entryCount: null,
          parityKey: null,
        },
      ],
      new Date("2026-08-23T00:00:00.000Z"),
      21600,
    );

    expect(dashboard.services[0]).toMatchObject({
      status: "stale",
      stale: true,
      ageSeconds: 86400,
    });
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

  const dashboardFor = (
    observations: ServiceObservation[],
    rendezvousObservations: RendezvousHealthObservation[] = [],
  ) =>
    aggregateDashboard(
      [],
      [],
      SERVICE_PROBES,
      observations,
      now,
      21600,
      rendezvousObservations,
    );

  const rendezvousObservation = (
    overrides: Partial<RendezvousHealthObservation> = {},
  ): RendezvousHealthObservation => ({
    id: "rendezvous-health:1",
    receivedAt: "2026-08-23T12:00:01.000Z",
    observationGeneration: 12,
    sourceTimestamp: Math.floor(now.getTime() / 1000) - 2,
    windowStartedAt: Math.floor(now.getTime() / 1000) - 2,
    windowEndedAt: Math.floor(now.getTime() / 1000) + 298,
    freshnessState: "fresh",
    sourceStatus: "healthy",
    recentAuthenticatedAdmissions: 1,
    recentSessions: {
      total: 2,
      outcomes: {
        completed: 1,
        client_disconnected: 0,
        session_expired: 0,
        protocol_error: 0,
        server_unavailable: 0,
        server_replaced: 0,
        authorization_failed: 0,
        internal_error: 1,
      },
    },
    canary: {
      type: "end_to_end",
      route: "reachable",
      authenticatedControl: "passed",
      recentAdmission: "passed",
      observedAt: Math.floor(now.getTime() / 1000) - 1,
    },
    reason: "canary_passed",
    error: null,
    ...overrides,
  });

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
    expect(partial).toMatchObject({
      surfaces: { listings: { status: "attention" } },
    });
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

  it("promotes a fresh validated rendezvous aggregate alongside healthy listings", () => {
    const service = dashboardFor(
      listingProbes.map((probe) => listingObservation(probe.id)),
      [rendezvousObservation()],
    ).services.find((candidate) => candidate.id === "metaserver");

    expect(service).toMatchObject({
      status: "passed",
      surfaces: {
        listings: { status: "passed" },
        rendezvous: {
          status: "passed",
          freshness: { state: "fresh", ageSeconds: 2, maximumAgeSeconds: 300 },
          routeStatus: "passed",
          controlsStatus: "passed",
          admissionStatus: "passed",
          observationSource: "private-service-binding",
          safeObservationAvailable: true,
          recentAuthenticatedAdmissions: 1,
          recentSessions: {
            total: 2,
            outcomes: { completed: 1, internal_error: 1 },
          },
          canary: {
            type: "end_to_end",
            route: "reachable",
            authenticatedControl: "passed",
            recentAdmission: "passed",
          },
          reason: "canary_passed",
          error: null,
        },
      },
    });
  });

  it.each([
    [
      "failed",
      rendezvousObservation({
        sourceStatus: "failed",
        recentAuthenticatedAdmissions: 0,
        recentSessions: {
          total: 0,
          outcomes: {
            completed: 0,
            client_disconnected: 0,
            session_expired: 0,
            protocol_error: 0,
            server_unavailable: 0,
            server_replaced: 0,
            authorization_failed: 0,
            internal_error: 0,
          },
        },
        canary: {
          type: "end_to_end",
          route: "failed",
          authenticatedControl: "not_observed",
          recentAdmission: "not_observed",
          observedAt: Math.floor(now.getTime() / 1000) - 1,
        },
        reason: "canary_failed",
      }),
    ],
    [
      "stale",
      rendezvousObservation({
        sourceTimestamp: Math.floor(now.getTime() / 1000) - 301,
        windowStartedAt: Math.floor(now.getTime() / 1000) - 301,
        windowEndedAt: Math.floor(now.getTime() / 1000) - 1,
        freshnessState: "stale",
        sourceStatus: "stale",
        recentAuthenticatedAdmissions: 0,
        recentSessions: {
          total: 0,
          outcomes: {
            completed: 0,
            client_disconnected: 0,
            session_expired: 0,
            protocol_error: 0,
            server_unavailable: 0,
            server_replaced: 0,
            authorization_failed: 0,
            internal_error: 0,
          },
        },
        canary: {
          type: "none",
          route: "not_observed",
          authenticatedControl: "not_observed",
          recentAdmission: "not_observed",
          observedAt: null,
        },
        reason: "stale_source",
      }),
    ],
  ] as const)(
    "maps a %s rendezvous observation conservatively",
    (status, observation) => {
      const service = dashboardFor([], [observation]).services.find(
        (candidate) => candidate.id === "metaserver",
      );
      if (!service || service.surface !== "metaserver")
        throw new Error("missing metaserver");
      expect(service?.surfaces.rendezvous.status).toBe(status);
      expect(service?.status).toBe(status);
    },
  );

  it("turns a malformed stored observation into a safe unknown projection", () => {
    const malformed = {
      ...rendezvousObservation(),
      canary: { ...rendezvousObservation().canary, privateRoomId: "secret" },
    } as unknown as RendezvousHealthObservation;
    const service = dashboardFor([], [malformed]).services.find(
      (candidate) => candidate.id === "metaserver",
    );
    if (!service || service.surface !== "metaserver")
      throw new Error("missing metaserver");

    expect(service?.surfaces.rendezvous).toMatchObject({
      status: "unknown",
      safeObservationAvailable: false,
      observationSource: null,
      reason: "malformed_observation",
    });
  });

  it.each(["no_observation", "malformed_observation"] as const)(
    "keeps the producer %s fallback unknown without a safe observation",
    (reason) => {
      const service = dashboardFor(
        [],
        [
          rendezvousObservation({
            observationGeneration: 0,
            sourceTimestamp: null,
            windowStartedAt: null,
            windowEndedAt: null,
            freshnessState: "no_observation",
            sourceStatus: "no_usable_observation",
            recentAuthenticatedAdmissions: 0,
            recentSessions: {
              total: 0,
              outcomes: {
                completed: 0,
                client_disconnected: 0,
                session_expired: 0,
                protocol_error: 0,
                server_unavailable: 0,
                server_replaced: 0,
                authorization_failed: 0,
                internal_error: 0,
              },
            },
            canary: {
              type: "none",
              route: "not_observed",
              authenticatedControl: "not_observed",
              recentAdmission: "not_observed",
              observedAt: null,
            },
            reason,
            error: null,
          }),
        ],
      ).services.find((candidate) => candidate.id === "metaserver");
      if (!service || service.surface !== "metaserver")
        throw new Error("missing metaserver");

      expect(service.surfaces.rendezvous).toMatchObject({
        status: "unknown",
        safeObservationAvailable: false,
        observationSource: null,
        reason,
        observedAt: null,
        error: "No positive rendezvous health evidence is available.",
      });
      expect(() => validateClassicRendezvous({ services: [service] })).not.toThrow();
    },
  );

  it.each([
    [
      "invalid response headers",
      "source_invalid_headers" as const,
      "Private rendezvous health source returned invalid response headers.",
    ],
    [
      "invalid payload",
      "source_invalid_payload" as const,
      "Private rendezvous health source returned an invalid payload.",
    ],
  ])("keeps %s diagnostics bounded and distinct", (_label, error, message) => {
    const service = dashboardFor(
      [],
      [
        rendezvousObservation({
          sourceStatus: null,
          observationGeneration: 0,
          sourceTimestamp: null,
          windowStartedAt: null,
          windowEndedAt: null,
          freshnessState: "no_observation",
          recentAuthenticatedAdmissions: 0,
          recentSessions: {
            total: 0,
            outcomes: {
              completed: 0,
              client_disconnected: 0,
              session_expired: 0,
              protocol_error: 0,
              server_unavailable: 0,
              server_replaced: 0,
              authorization_failed: 0,
              internal_error: 0,
            },
          },
          canary: {
            type: "none",
            route: "not_observed",
            authenticatedControl: "not_observed",
            recentAdmission: "not_observed",
            observedAt: null,
          },
          reason: null,
          error,
        }),
      ],
    ).services.find((candidate) => candidate.id === "metaserver");
    if (!service || service.surface !== "metaserver")
      throw new Error("missing metaserver");

    expect(service.surfaces.rendezvous).toMatchObject({
      status: "unknown",
      reason: null,
      error: message,
      safeObservationAvailable: false,
    });
  });
});
