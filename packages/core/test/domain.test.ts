import { describe, expect, test } from "vitest";

import {
  AnalysisErrorSchema,
  ArtifactDiffSchema,
  AuditEventSchema,
  BenchmarkManifestSchema,
  CaptureSessionSchema,
  EvidenceSchema,
  FindingSchema,
  PipelineRunSchema,
  PluginManifestSchema,
  ProjectSchema,
  RedactionPolicySchema,
  WorkspaceSchema,
  createAnalysisError,
  createId,
  err,
  isErr,
  isOk,
  ok
} from "../src/index.js";

describe("core domain contracts", () => {
  test("creates stable prefixed ids", () => {
    const id = createId("proj", "demo");

    expect(id).toBe("proj_demo");
  });

  test("rejects ids with invalid prefixes", () => {
    expect(() => createId("Project", "demo")).toThrow(/prefix/i);
  });

  test("validates project and workspace schema versions", () => {
    const workspace = WorkspaceSchema.parse({
      id: "ws_demo",
      name: "Demo Workspace",
      created_at: "2026-06-09T00:00:00.000Z",
      updated_at: "2026-06-09T00:00:00.000Z"
    });

    const project = ProjectSchema.parse({
      id: "proj_demo",
      workspace_id: workspace.id,
      name: "Demo Project",
      root_path: "/tmp/demo",
      project_schema_version: 1,
      evidence_schema_version: 1,
      artifact_schema_version: 1,
      worker_protocol_version: 1,
      created_at: "2026-06-09T00:00:00.000Z",
      updated_at: "2026-06-09T00:00:00.000Z"
    });

    expect(project.project_schema_version).toBe(1);
  });

  test("validates evidence facts findings pipeline and audit references", () => {
    const session = CaptureSessionSchema.parse({
      id: "cap_demo",
      project_id: "proj_demo",
      source: "import",
      status: "completed",
      started_at: "2026-06-09T00:00:00.000Z",
      ended_at: "2026-06-09T00:01:00.000Z"
    });

    const evidence = EvidenceSchema.parse({
      id: "ev_demo",
      project_id: "proj_demo",
      source_id: "src_demo",
      capture_session_id: session.id,
      kind: "http_exchange",
      schema_version: 1,
      observed_at: "2026-06-09T00:00:30.000Z",
      raw_ref: "blob_raw",
      normalized_ref: "blob_norm",
      redaction_status: "redacted",
      summary: {
        method: "GET",
        url: "https://example.test/api/users",
        status_code: 200
      }
    });

    const finding = FindingSchema.parse({
      id: "find_demo",
      project_id: "proj_demo",
      kind: "api_endpoint",
      title: "GET /api/users",
      confidence: 0.9,
      evidence_refs: [evidence.id],
      fact_refs: ["fact_endpoint"],
      pipeline_run_id: "run_demo",
      created_at: "2026-06-09T00:02:00.000Z"
    });

    const run = PipelineRunSchema.parse({
      id: "run_demo",
      project_id: "proj_demo",
      name: "empty",
      version: "0.1.0",
      status: "succeeded",
      input_refs: [evidence.id],
      output_ids: [finding.id],
      warnings: [],
      metrics: { steps: 0 },
      created_at: "2026-06-09T00:02:00.000Z",
      updated_at: "2026-06-09T00:02:01.000Z"
    });

    const audit = AuditEventSchema.parse({
      id: "audit_demo",
      project_id: "proj_demo",
      actor: "cli",
      action: "pipeline.run",
      target_type: "pipeline_run",
      target_id: run.id,
      metadata: { status: run.status },
      created_at: "2026-06-09T00:02:01.000Z"
    });

    expect(finding.evidence_refs).toEqual([evidence.id]);
    expect(audit.metadata.status).toBe("succeeded");
  });

  test("bounds confidence and policy versions", () => {
    expect(() =>
      FindingSchema.parse({
        id: "find_bad",
        project_id: "proj_demo",
        kind: "api_endpoint",
        title: "Impossible",
        confidence: 1.1,
        evidence_refs: ["ev_demo"],
        created_at: "2026-06-09T00:02:00.000Z"
      })
    ).toThrow();

    const policy = RedactionPolicySchema.parse({
      id: "policy_demo",
      project_id: "proj_demo",
      version: 1,
      mode: "default",
      rules: ["credentials", "supported_pii_candidates"],
      created_at: "2026-06-09T00:00:00.000Z"
    });

    expect(policy.rules).toContain("credentials");
  });

  test("uses structured errors and results", () => {
    const error = createAnalysisError({
      code: "PROJECT_NOT_FOUND",
      message: "Project not found",
      recoverable: true
    });

    const parsed = AnalysisErrorSchema.parse(error);
    const success = ok({ id: "proj_demo" });
    const failure = err(parsed);

    expect(isOk(success)).toBe(true);
    expect(isErr(failure)).toBe(true);
    expect(failure.error.code).toBe("PROJECT_NOT_FOUND");
  });

  test("validates phase six public schemas", () => {
    const manifest = PluginManifestSchema.parse({
      name: "example-log-provider",
      type: "import_provider",
      version: "0.1.0",
      compatible_with: { core: ">=1.0 <2.0" },
      capabilities: ["import_provider"]
    });
    const diff = ArtifactDiffSchema.parse({
      schema_version: 1,
      generated_at: "2026-06-26T00:00:00.000Z",
      before_artifact_id: "art_before",
      after_artifact_id: "art_after",
      ignored_fields: ["generated_at", "id"],
      entries: [
        {
          kind: "endpoint_added",
          path: "GET /orders",
          after: { method: "GET", path_template: "/orders" },
          summary: "Endpoint added: GET /orders"
        }
      ]
    });
    const benchmark = BenchmarkManifestSchema.parse({
      schema_version: 1,
      generated_at: "2026-06-26T00:00:00.000Z",
      profiles: [
        {
          name: "L",
          requests: 1_000_000,
          max_duration_ms: 3_600_000,
          max_memory_mb: 2_048,
          min_metadata_retention_ratio: 1
        }
      ]
    });

    expect(manifest.permissions.raw_evidence).toBe(false);
    expect(() =>
      PluginManifestSchema.parse({
        ...manifest,
        capabilities: ["diagnostics"]
      })
    ).toThrow();
    expect(diff.entries.at(0)?.kind).toBe("endpoint_added");
    expect(benchmark.profiles.at(0)?.requests).toBe(1_000_000);
  });
});
