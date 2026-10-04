import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { describe, expect, it } from "vitest";
import { onRequestPost } from "../../functions/api/github/webhook";

const migrations = new URL("../../migrations/", import.meta.url);
const migrationNames = readdirSync(migrations)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function applyMigrations(database: DatabaseSync, names: string[]) {
  for (const name of names)
    database.exec(readFileSync(new URL(name, migrations), "utf8"));
}

function emptyObservation(id: string, reason: string | null, error: string | null) {
  return {
    id,
    received_at: "2026-08-23T12:00:00.000Z",
    observation_generation: 0,
    source_timestamp: null,
    window_started_at: null,
    window_ended_at: null,
    freshness_state: "no_observation",
    source_status: error === null ? "no_usable_observation" : null,
    recent_authenticated_admissions: 0,
    session_total: 0,
    session_completed: 0,
    session_client_disconnected: 0,
    session_expired: 0,
    session_protocol_error: 0,
    session_server_unavailable: 0,
    session_server_replaced: 0,
    session_authorization_failed: 0,
    session_internal_error: 0,
    canary_type: "none",
    canary_route: "not_observed",
    canary_authenticated_control: "not_observed",
    canary_recent_admission: "not_observed",
    canary_observed_at: null,
    reason,
    error,
  };
}

function insertObservation(database: DatabaseSync, row: Record<string, SQLInputValue>) {
  database
    .prepare(
      `INSERT INTO rendezvous_health_observations (${Object.keys(row).join(",")}) VALUES (${Object.keys(
        row,
      )
        .map(() => "?")
        .join(",")})`,
    )
    .run(...Object.values(row));
}

// Execute the application's D1 statements against the migrated SQLite schema.
function d1Adapter(database: DatabaseSync) {
  function prepare(sql: string) {
    let values: SQLInputValue[] = [];
    return {
      bind(...parameters: SQLInputValue[]) {
        values = parameters;
        return this;
      },
      async all() {
        return { results: database.prepare(sql).all(...values) };
      },
      async first() {
        return database.prepare(sql).get(...values) ?? null;
      },
      async run() {
        return {
          meta: { changes: Number(database.prepare(sql).run(...values).changes) },
        };
      },
    };
  }
  return {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

describe("rendezvous fallback migration", () => {
  it("preserves retained rows and accepts only bounded fallback diagnostics", () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrations(
        database,
        migrationNames.filter((name) => name < "0007"),
      );
      insertObservation(database, emptyObservation("empty", "no_observation", null));
      for (const error of [
        "source_not_configured",
        "source_unauthorized",
        "source_unavailable",
        "malformed_source",
      ]) {
        insertObservation(database, emptyObservation(error, null, error));
      }
      const before = database
        .prepare("SELECT * FROM rendezvous_health_observations ORDER BY id")
        .all();
      applyMigrations(
        database,
        migrationNames.filter((name) => name >= "0007"),
      );
      expect(
        database
          .prepare("SELECT * FROM rendezvous_health_observations ORDER BY id")
          .all(),
      ).toEqual(before);
      insertObservation(
        database,
        emptyObservation("fallback", "malformed_observation", null),
      );
      for (const error of ["source_invalid_headers", "source_invalid_payload"]) {
        insertObservation(database, emptyObservation(error, null, error));
      }
      expect(() =>
        insertObservation(
          database,
          emptyObservation("private", null, "private-source-body"),
        ),
      ).toThrow();
      expect(() =>
        insertObservation(database, {
          ...emptyObservation("inconsistent", "malformed_observation", null),
          recent_authenticated_admissions: 1,
        }),
      ).toThrow();
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'rendezvous_health_observations_0006'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'rendezvous_health_observations_received_at'",
          )
          .get(),
      ).toBeDefined();
    } finally {
      database.close();
    }
  });

  it("accepts and deduplicates a signed webhook after the complete migration chain", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      applyMigrations(database, migrationNames);
      const secret = crypto.randomUUID();
      const body = JSON.stringify({
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
      });
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const digest = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(body),
      );
      const signature = `sha256=${Buffer.from(digest).toString("hex")}`;
      async function deliver(signatureHeader: string) {
        const request = new Request("https://observatory.invalid/api/github/webhook", {
          method: "POST",
          body,
          headers: {
            "x-github-delivery": "migration-smoke",
            "x-github-event": "workflow_run",
            "x-hub-signature-256": signatureHeader,
          },
        });
        return onRequestPost({
          request,
          env: { DB: d1Adapter(database), GITHUB_WEBHOOK_SECRET: secret },
        } as unknown as Parameters<typeof onRequestPost>[0]);
      }
      expect((await deliver("sha256=invalid")).status).toBe(401);
      const response = await deliver(signature);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        accepted: true,
        inserted: 1,
        mappedCoordinates: 1,
      });
      expect(await (await deliver(signature)).json()).toMatchObject({
        duplicate: true,
        inserted: 0,
      });
      expect(
        database
          .prepare(
            "SELECT status FROM coordinate_observations WHERE coordinate_id = 'default:observatory'",
          )
          .get(),
      ).toMatchObject({ status: "passed" });
    } finally {
      database.close();
    }
  });
});
