import { describe, expect, it } from "vitest";
import { recordGitHubDelivery } from "./d1";
import type { NormalizedObservation } from "../domain/types";

const coordinate = {
  id: "default:observatory",
  repository: "atrinik/observatory",
  component: "observatory",
  stack: "default" as const,
  generation: "replacement" as const,
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
      return { meta: { changes: 1 } };
    }

    if (this.sql.startsWith("UPDATE github_deliveries")) {
      return { meta: { changes: 1 } };
    }

    throw new Error(`unexpected batch query: ${this.sql}`);
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
});
