import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Fact, Finding, PipelineRun, Project } from "@software-analysis/core";
import { afterEach, describe, expect, test } from "vitest";

import {
  SqliteFactRepository,
  SqliteFindingRepository,
  SqliteCaptureSessionRepository,
  SqliteEvidenceRepository,
  SqliteEvidenceSourceRepository,
  SqlitePipelineRunRepository,
  SqliteProjectRepository,
  createSqliteClient,
  initWorkspace,
  listSqliteTables,
  runMigrations
} from "../src/index.js";

const tempDirs: string[] = [];

async function tempProject(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "software-analysis-sqlite-"));
  tempDirs.push(path);
  await initWorkspace(path, { name: "Demo Project", workspaceName: "Local Workspace" });
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sqlite migrations and repositories", () => {
  test("runs migrations idempotently and creates the stage one tables", async () => {
    const root = await tempProject();
    const client = createSqliteClient(root);

    try {
      const first = runMigrations(client);
      const second = runMigrations(client);
      const tables = listSqliteTables(client);

      expect(first.applied).toEqual(["0001_initial"]);
      expect(second.applied).toEqual([]);
      expect(tables).toEqual(
        expect.arrayContaining([
          "workspaces",
          "projects",
          "capture_sessions",
          "evidence_sources",
          "evidence_index",
          "facts",
          "findings",
          "pipeline_runs",
          "artifacts",
          "redaction_policies",
          "audit_events",
          "schema_migrations"
        ])
      );
    } finally {
      client.close();
    }
  });

  test("rolls back a failed migration transaction", async () => {
    const root = await tempProject();
    const client = createSqliteClient(root);

    try {
      expect(() =>
        runMigrations(client, [
          {
            id: "9999_fail",
            statements: [
              "create table rolled_back (id text primary key)",
              "select nope from missing_table"
            ]
          }
        ])
      ).toThrow(/9999_fail/);

      expect(listSqliteTables(client)).not.toContain("rolled_back");
    } finally {
      client.close();
    }
  });

  test("persists project fact finding and pipeline run as project scoped domain objects", async () => {
    const root = await tempProject();
    const client = createSqliteClient(root);

    try {
      runMigrations(client);
      const projects = new SqliteProjectRepository(client);
      const captureSessions = new SqliteCaptureSessionRepository(client);
      const evidenceSources = new SqliteEvidenceSourceRepository(client);
      const evidence = new SqliteEvidenceRepository(client);
      const facts = new SqliteFactRepository(client);
      const findings = new SqliteFindingRepository(client);
      const pipelineRuns = new SqlitePipelineRunRepository(client);

      const project: Project = {
        id: "proj_demo",
        workspace_id: "ws_demo",
        name: "Demo Project",
        root_path: root,
        project_schema_version: 1,
        evidence_schema_version: 1,
        artifact_schema_version: 1,
        worker_protocol_version: 1,
        created_at: "2026-06-09T00:00:00.000Z",
        updated_at: "2026-06-09T00:00:00.000Z"
      };
      const fact: Fact = {
        id: "fact_endpoint",
        project_id: project.id,
        kind: "endpoint",
        data: { method: "GET", path: "/users" },
        evidence_refs: ["ev_demo"],
        created_at: "2026-06-09T00:01:00.000Z"
      };
      const finding: Finding = {
        id: "find_endpoint",
        project_id: project.id,
        kind: "api_endpoint",
        title: "GET /users",
        confidence: 0.95,
        evidence_refs: ["ev_demo"],
        fact_refs: [fact.id],
        created_at: "2026-06-09T00:02:00.000Z"
      };
      const run: PipelineRun = {
        id: "run_demo",
        project_id: project.id,
        name: "api",
        version: "0.1.0",
        status: "succeeded",
        input_refs: ["ev_demo"],
        output_ids: [fact.id, finding.id],
        warnings: [],
        metrics: { facts: 1, findings: 1 },
        created_at: "2026-06-09T00:03:00.000Z",
        updated_at: "2026-06-09T00:03:01.000Z"
      };

      await projects.save(project);
      await captureSessions.save({
        id: "cap_demo",
        project_id: project.id,
        source: "import",
        status: "completed",
        started_at: "2026-06-09T00:00:00.000Z"
      });
      await evidenceSources.save({
        id: "src_demo",
        project_id: project.id,
        kind: "har",
        source_hash: "hash-demo",
        created_at: "2026-06-09T00:00:00.000Z"
      });
      await evidence.save({
        id: "ev_demo",
        project_id: project.id,
        source_id: "src_demo",
        capture_session_id: "cap_demo",
        kind: "http_exchange",
        schema_version: 1,
        observed_at: "2026-06-09T00:00:30.000Z",
        raw_ref: "blob_raw",
        normalized_ref: "blob_norm",
        redaction_status: "redacted",
        summary: {
          type: "http_flow",
          method: "GET",
          url: "https://example.test/users",
          host: "example.test",
          path: "/users",
          status_code: 200,
          request_headers: {},
          response_headers: {},
          warnings: [],
          redactions: []
        }
      });
      await facts.save(fact);
      await findings.save(finding);
      await pipelineRuns.save(run);

      await expect(projects.get(project.id)).resolves.toEqual(project);
      await expect(captureSessions.listByProject(project.id)).resolves.toHaveLength(1);
      await expect(evidenceSources.listByProject(project.id)).resolves.toHaveLength(1);
      await expect(evidence.listByProject(project.id)).resolves.toHaveLength(1);
      await expect(facts.listByProject(project.id)).resolves.toEqual([fact]);
      await expect(findings.get(finding.id)).resolves.toEqual(finding);
      await expect(pipelineRuns.listByProject(project.id)).resolves.toEqual([run]);
    } finally {
      client.close();
    }
  });
});
