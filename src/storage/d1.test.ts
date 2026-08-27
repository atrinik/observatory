import { describe, expect, it } from "vitest";
import { readDashboard, recordGitHubDelivery, runRendezvousHealthProbe } from "./d1";
import type { NormalizedObservation } from "../domain/types";

const coordinate = {
  id: "default:observatory",
  repository: "atrinik/observatory",
  component: "observatory",
  stack: "default" as const,
  generation: "replacement" as const,
  deployment_applicable: 1,
};

const observation: NormalizedObservation = {
  repository: coordinate.repository,
  kind: "build",
  status: "passed",
  occurredAt: "2026-08-23T12:00:00.000Z",
  ref: "main",
  commitSha: "abc123",
  title: "Validate",
  sourceUrl: "https://github.com/atrinik/observatory/actions/runs/1",
  workflowName: "Validate",
  releaseTag: null,
  packageUrl: null,
  artifactUrl: null,
};

class FakeDatabase {
  readonly deliveries = new Map<string, string>();
  readonly observationIds = new Set<string>();
  readonly coordinateObservations: unknown[] = [];
  readonly serviceProbeRows: unknown[] = [];
  readonly serviceObservationRows: unknown[] = [];
  readonly rendezvousHealthRows: unknown[] = [];
  readonly rendezvousHealthParameters: unknown[][] = [];

  readonly prepare = (sql: string) => new FakeStatement(this, sql);

  async batch(statements: unknown[]) {
    return statements.map((statement) => (statement as FakeStatement).execute());
  }
}

class FakeStatement {
  private parameters: unknown[] = [];

  constructor(
    private readonly database: FakeDatabase,
    private readonly sql: string,
  ) {}

  bind(...parameters: unknown[]) {
    this.parameters = parameters;
    return this;
  }

  async all<T>() {
    if (this.sql.includes("FROM component_coordinates")) {
      return { results: [coordinate] as T[] };
    }
    if (this.sql.includes("FROM coordinate_observations")) {
      return { results: this.database.coordinateObservations as T[] };
    }
    if (this.sql.includes("FROM service_probes")) {
      return { results: this.database.serviceProbeRows as T[] };
    }
    if (this.sql.includes("FROM service_observations")) {
      return { results: this.database.serviceObservationRows as T[] };
    }
    if (this.sql.includes("FROM rendezvous_health_observations")) {
      return { results: this.database.rendezvousHealthRows as T[] };
    }
    throw new Error(`unexpected all query: ${this.sql}`);
  }

  async first<T>() {
    const deliveryId = String(this.parameters[0]);
    return { payload_digest: this.database.deliveries.get(deliveryId) } as T;
  }

  execute() {
    if (this.sql.startsWith("INSERT OR IGNORE INTO github_deliveries")) {
      const deliveryId = String(this.parameters[0]);
      if (this.database.deliveries.has(deliveryId)) return { meta: { changes: 0 } };
      this.database.deliveries.set(deliveryId, String(this.parameters[2]));
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT OR IGNORE INTO coordinate_observations")) {
      const id = String(this.parameters[0]);
      if (this.database.observationIds.has(id)) return { meta: { changes: 0 } };
      this.database.observationIds.add(id);
      this.database.coordinateObservations.push({
        id,
        ref: this.parameters[7],
      });
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE github_deliveries")) {
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("INSERT OR IGNORE INTO rendezvous_health_observations")) {
      this.database.rendezvousHealthParameters.push(this.parameters);
      return { meta: { changes: 1 } };
    }

    throw new Error(`unexpected batch query: ${this.sql}`);
  }

  async run() {
    return this.execute();
  }
}

describe("D1 GitHub delivery persistence", () => {
  it("makes replayed deliveries idempotent and detects digest conflicts", async () => {
    const database = new FakeDatabase() as unknown as D1Database;

    await expect(
      recordGitHubDelivery(
        database,
        "delivery-1",
        "workflow_run",
        "digest-a",
        "2026-08-23T12:00:01.000Z",
        [observation],
      ),
    ).resolves.toMatchObject({
      duplicate: false,
      conflict: false,
      inserted: 1,
      mapped: 1,
    });

    await expect(
      recordGitHubDelivery(
        database,
        "delivery-1",
        "workflow_run",
        "digest-a",
        "2026-08-23T12:00:02.000Z",
        [observation],
      ),
    ).resolves.toMatchObject({
      duplicate: true,
      conflict: false,
      inserted: 0,
      mapped: 0,
    });

    await expect(
      recordGitHubDelivery(
        database,
        "delivery-1",
        "workflow_run",
        "digest-b",
        "2026-08-23T12:00:03.000Z",
        [observation],
      ),
    ).resolves.toMatchObject({
      duplicate: true,
      conflict: true,
      inserted: 0,
      mapped: 0,
    });
  });

  it("rejects a non-main build even when persistence is called directly", async () => {
    const database = new FakeDatabase();
    const nonMainObservation = { ...observation, ref: "feature/status" };

    await expect(
      recordGitHubDelivery(
        database as unknown as D1Database,
        "delivery-feature",
        "workflow_run",
        "digest-feature",
        "2026-08-23T12:00:01.000Z",
        [nonMainObservation],
      ),
    ).resolves.toMatchObject({
      duplicate: false,
      conflict: false,
      inserted: 0,
      mapped: 0,
    });
    expect(database.observationIds.size).toBe(0);
  });
});

describe("D1 dashboard reads", () => {
  it("maps the deployment applicability column into the public coordinate", async () => {
    const database = new FakeDatabase() as unknown as D1Database;

    await expect(
      readDashboard(database, new Date("2026-08-23T12:00:00.000Z")),
    ).resolves.toMatchObject({
      coordinates: [
        {
          id: "default:observatory",
          deploymentApplicable: true,
          deployment: { status: "unknown" },
          overall: "unknown",
        },
      ],
    });
  });

  it("maps a validated rendezvous observation into the public metaserver surface", async () => {
    const database = new FakeDatabase();
    database.serviceProbeRows.push({
      id: "metaserver",
      name: "Classic listings · HTML",
      url: "https://classic.meta.atrinik.org/index.html",
      stack: "default",
      stale_after_seconds: 1800,
      surface: "listings",
      format: "html",
    });
    database.rendezvousHealthRows.push({
      id: "rendezvous-health:observation-1",
      received_at: "2026-08-23T12:00:01.000Z",
      observation_generation: 12,
      source_timestamp: 1787486398,
      window_started_at: 1787486398,
      window_ended_at: 1787486698,
      freshness_state: "fresh",
      source_status: "healthy",
      recent_authenticated_admissions: 1,
      session_total: 1,
      session_completed: 1,
      session_client_disconnected: 0,
      session_expired: 0,
      session_protocol_error: 0,
      session_server_unavailable: 0,
      session_server_replaced: 0,
      session_authorization_failed: 0,
      session_internal_error: 0,
      canary_type: "end_to_end",
      canary_route: "reachable",
      canary_authenticated_control: "passed",
      canary_recent_admission: "passed",
      canary_observed_at: 1787486399,
      reason: "canary_passed",
      error: null,
    });

    await expect(
      readDashboard(
        database as unknown as D1Database,
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      services: [
        {
          id: "metaserver",
          surfaces: {
            rendezvous: {
              status: "passed",
              safeObservationAvailable: true,
              observationSource: "private-service-binding",
              recentAuthenticatedAdmissions: 1,
            },
          },
        },
      ],
    });
  });

  it("keeps old event-driven status passed in the public dashboard projection", async () => {
    const database = new FakeDatabase();
    database.coordinateObservations.push({
      id: "old-build",
      coordinate_id: coordinate.id,
      kind: "build",
      status: "passed",
      observed_at: "2026-08-22T00:00:00.000Z",
      received_at: "2026-08-22T00:00:01.000Z",
      ref: "main",
      commit_sha: "abc123",
      title: "Validate",
      source_url: "https://github.com/atrinik/observatory/actions/runs/1",
      workflow_name: "Validate",
      release_tag: null,
      package_url: null,
      artifact_url: null,
    });

    await expect(
      readDashboard(
        database as unknown as D1Database,
        new Date("2026-08-23T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      coordinates: [
        {
          build: { status: "passed", stale: false, ageSeconds: 86400 },
          overall: "unknown",
        },
      ],
    });
  });

  it("records a fixed error when the private rendezvous source is not configured", async () => {
    const database = new FakeDatabase();

    await expect(
      runRendezvousHealthProbe(
        database as unknown as D1Database,
        undefined,
        undefined,
        undefined,
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).resolves.toEqual({
      stored: true,
      status: null,
      error: "source_not_configured",
    });
    expect(database.rendezvousHealthParameters).toHaveLength(1);
    expect(database.rendezvousHealthParameters[0]).not.toContain("room");
  });

  it("maps unauthorized and malformed private responses to bounded error codes", async () => {
    const unauthorizedDatabase = new FakeDatabase();
    const testToken = crypto.randomUUID();
    let requestedUrl = "";
    let authorization = "";
    const unauthorizedBinding = {
      fetch: async (request: Request) => {
        requestedUrl = request.url;
        authorization = request.headers.get("authorization") ?? "";
        return new Response("private response", { status: 401 });
      },
    };
    await expect(
      runRendezvousHealthProbe(
        unauthorizedDatabase as unknown as D1Database,
        unauthorizedBinding,
        testToken,
        undefined,
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ status: null, error: "source_unauthorized" });
    expect(requestedUrl).toBe("https://internal.atrinik.invalid/v1/rendezvous-health");
    expect(authorization).toBe(`Bearer ${testToken}`);
    expect(unauthorizedDatabase.rendezvousHealthParameters[0]).not.toContain(
      "private response",
    );

    const malformedDatabase = new FakeDatabase();
    const malformedBinding = {
      fetch: async () =>
        new Response("not-json", {
          headers: { "content-type": "text/plain" },
        }),
    };
    await expect(
      runRendezvousHealthProbe(
        malformedDatabase as unknown as D1Database,
        malformedBinding,
        testToken,
        undefined,
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ status: null, error: "malformed_source" });
  });

  it("times out a stalled private binding without persisting source details", async () => {
    const database = new FakeDatabase();
    const testToken = crypto.randomUUID();
    let aborted = false;
    const stalledBinding = {
      fetch: (request: Request) =>
        new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    };

    await expect(
      runRendezvousHealthProbe(
        database as unknown as D1Database,
        stalledBinding,
        testToken,
        "1",
        new Date("2026-08-23T12:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      stored: true,
      status: null,
      error: "source_unavailable",
    });
    expect(aborted).toBe(true);
    expect(database.rendezvousHealthParameters[0]).not.toContain("aborted");
  });

  it("does not let retained non-main rows change the public build status", async () => {
    const database = new FakeDatabase();
    database.coordinateObservations.push(
      {
        id: "main-pass",
        coordinate_id: coordinate.id,
        kind: "build",
        status: "passed",
        observed_at: "2026-08-22T00:00:00.000Z",
        received_at: "2026-08-22T00:00:01.000Z",
        ref: "main",
        commit_sha: "abc123",
        title: "Validate",
        source_url: "https://github.com/atrinik/observatory/actions/runs/1",
        workflow_name: "Validate",
        release_tag: null,
        package_url: null,
        artifact_url: null,
      },
      {
        id: "feature-failure",
        coordinate_id: coordinate.id,
        kind: "build",
        status: "failed",
        observed_at: "2026-08-23T00:00:00.000Z",
        received_at: "2026-08-23T00:00:01.000Z",
        ref: "feature/status",
        commit_sha: "feature-sha",
        title: "Validate",
        source_url: "https://github.com/atrinik/observatory/actions/runs/2",
        workflow_name: "Validate",
        release_tag: null,
        package_url: null,
        artifact_url: null,
      },
    );

    await expect(
      readDashboard(
        database as unknown as D1Database,
        new Date("2026-08-23T00:05:00.000Z"),
      ),
    ).resolves.toMatchObject({
      coordinates: [
        {
          build: {
            status: "passed",
            latest: { id: "main-pass" },
            mostRecentFailure: null,
          },
        },
      ],
    });
  });
});
