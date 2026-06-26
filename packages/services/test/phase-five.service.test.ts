import type {
  Artifact,
  ArtifactStore,
  AuditEvent,
  AuditSink,
  BlobRef,
  BlobStore,
  CaptureSession,
  CaptureSessionStore,
  Evidence,
  EvidenceSource,
  EvidenceSourceStore,
  EvidenceStore,
  Fact,
  FactStore,
  Finding,
  FindingStore,
  PipelineRun,
  PipelineRunStore
} from "@software-analysis/core";
import { describe, expect, test } from "vitest";

import {
  ArtifactExportService,
  BusinessRuleCandidateService,
  DisabledLlmProvider,
  FakeLlmProvider,
  LlmEnrichmentService
} from "../src/index.js";

class MemoryBlobStore implements BlobStore {
  readonly blobs = new Map<string, Uint8Array>();

  put(input: { content: Uint8Array; media_type: string }): Promise<BlobRef> {
    const id = `blob_${String(this.blobs.size + 1)}`;
    this.blobs.set(id, input.content);
    return Promise.resolve({
      id,
      hash: id,
      media_type: input.media_type,
      size: input.content.byteLength
    });
  }

  get(ref: BlobRef): Promise<Uint8Array | null> {
    return Promise.resolve(this.blobs.get(ref.id) ?? null);
  }
}

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

class MemoryProjectScopedStore<T extends { id: string; project_id: string }> {
  readonly items = new Map<string, T>();

  save(item: T): Promise<T> {
    this.items.set(item.id, item);
    return Promise.resolve(item);
  }

  get(id: string): Promise<T | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }

  listByProject(projectId: string): Promise<T[]> {
    return Promise.resolve(
      [...this.items.values()].filter((item) => item.project_id === projectId)
    );
  }
}

describe("phase five services", () => {
  test("exports Postman, SDK context, workflow report, and entity report without secrets", async () => {
    const deps = createDeps();
    await seedEndpointFact(deps);
    await seedBusinessFacts(deps);
    const exported = new Map<string, string>();
    const exporter = new ArtifactExportService({
      artifacts: deps.artifacts,
      facts: deps.facts,
      pipelineRuns: deps.pipelineRuns,
      writeArtifact: (path, content) => {
        exported.set(path, content);
        return Promise.resolve(path);
      }
    });

    const postman = await exporter.exportPostmanCollection({ projectId: "proj_demo" });
    const sdk = await exporter.exportSdkContext({ projectId: "proj_demo" });
    const workflow = await exporter.exportWorkflowReport({ projectId: "proj_demo" });
    const entity = await exporter.exportEntityReport({ projectId: "proj_demo", format: "yaml" });
    const serialized = [...exported.values()].join("\n");

    expect(exported.get(postman.path)).toContain("collection/v2.1.0");
    expect(exported.get(postman.path)).toContain("{{access_token}}");
    expect(exported.get(sdk.path)).toContain('"schema_version": 1');
    expect(exported.get(workflow.path)).toContain("workflow_observed_session");
    expect(exported.get(entity.path)).toContain("# Entity Report");
    expect(serialized).not.toContain("raw-token");
  });

  test("LLM enrichment is disabled by default and fake provider creates audited annotations", async () => {
    const deps = createDeps();
    await seedEndpointFact(deps);
    const disabled = new LlmEnrichmentService({
      audit: deps.audit,
      facts: deps.facts,
      findings: deps.findings,
      provider: new DisabledLlmProvider()
    });
    const fake = new LlmEnrichmentService({
      audit: deps.audit,
      facts: deps.facts,
      findings: deps.findings,
      provider: new FakeLlmProvider()
    });

    const disabledResult = await disabled.enrich({
      projectId: "proj_demo",
      target: "endpoint_summary"
    });
    const fakeResult = await fake.enrich({ projectId: "proj_demo", target: "endpoint_summary" });

    expect(disabledResult.status).toBe("disabled");
    expect(fakeResult.status).toBe("succeeded");
    expect(fakeResult.finding_ids).toHaveLength(1);
    expect(deps.audit.events.map((event) => event.action)).toEqual(
      expect.arrayContaining(["llm.disabled", "llm.succeeded"])
    );
  });

  test("business rule candidates always stay candidate and include unresolved items", async () => {
    const deps = createDeps();
    await deps.evidence.save(httpEvidence("ev_reject", 422));
    await seedBusinessFacts(deps);
    const findings = new MemoryProjectScopedStore<Finding>();
    const service = new BusinessRuleCandidateService({
      audit: deps.audit,
      evidence: deps.evidence,
      facts: deps.facts,
      findings,
      pipelineRuns: deps.pipelineRuns
    });

    const result = await service.findCandidates({ projectId: "proj_demo" });
    const candidates = await service.listCandidates("proj_demo");

    expect(result.candidate_count).toBeGreaterThanOrEqual(2);
    expect(
      [...findings.items.values()].every(
        (finding) =>
          finding.kind !== "business_rule_candidate" ||
          (finding.data as { status?: string } | undefined)?.status === "candidate"
      )
    ).toBe(true);
    expect(candidates.every((candidate) => candidate.evidence_refs.length > 0)).toBe(true);
    expect(candidates.some((candidate) => candidate.unresolved_items.length > 0)).toBe(true);
  });
});

function createDeps() {
  return {
    audit: new MemoryAuditSink(),
    blobStore: new MemoryBlobStore(),
    captureSessions: new MemoryProjectScopedStore<CaptureSession>() as CaptureSessionStore,
    evidence: new MemoryProjectScopedStore<Evidence>() as EvidenceStore,
    evidenceSources: new MemoryProjectScopedStore<EvidenceSource>() as EvidenceSourceStore,
    facts: new MemoryProjectScopedStore<Fact>() as FactStore,
    findings: new MemoryProjectScopedStore<Finding>() as FindingStore,
    pipelineRuns: new MemoryProjectScopedStore<PipelineRun>() as PipelineRunStore,
    artifacts: new MemoryProjectScopedStore<Artifact>() as ArtifactStore
  };
}

async function seedEndpointFact(deps: ReturnType<typeof createDeps>): Promise<void> {
  await deps.facts.save({
    id: "fact_endpoint",
    project_id: "proj_demo",
    kind: "api_endpoint",
    evidence_refs: ["ev_ok"],
    pipeline_run_id: "run_api",
    created_at: "2026-06-26T00:00:00.000Z",
    data: {
      endpoint_id: "GET_api_example_test_orders",
      host: "api.example.test",
      schemes: ["https"],
      method: "GET",
      path_template: "/orders/{id}",
      analysis_sequence: 1,
      sample_count: 1,
      evidence_refs: ["ev_ok"],
      status_codes: [200],
      content_types: ["application/json"],
      confidence: 0.9,
      warnings: [],
      response_schemas: {
        "200": {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string" }
          }
        }
      },
      auth: {
        required: true,
        schemes: ["bearer"],
        confidence: 0.8,
        evidence_refs: ["ev_ok"]
      }
    }
  });
}

async function seedBusinessFacts(deps: ReturnType<typeof createDeps>): Promise<void> {
  await deps.facts.save({
    id: "fact_workflow",
    project_id: "proj_demo",
    kind: "workflow",
    evidence_refs: ["ev_ok"],
    pipeline_run_id: "run_workflow",
    created_at: "2026-06-26T00:00:00.000Z",
    data: {
      workflow_id: "workflow_observed_session",
      origin: "workflow-inference",
      status: "candidate",
      name: "Observed Session",
      confidence: 0.75,
      evidence_refs: ["ev_ok"],
      pipeline_run_id: "run_workflow",
      steps: [],
      unresolved_items: [],
      mermaid: "flowchart TD\n  A[Start]"
    }
  });
  await deps.facts.save({
    id: "fact_entity",
    project_id: "proj_demo",
    kind: "business_entity",
    evidence_refs: ["ev_ok"],
    pipeline_run_id: "run_entity",
    created_at: "2026-06-26T00:00:00.000Z",
    data: {
      entity_id: "entity_order",
      origin: "business-entity-inference",
      pipeline_run_id: "run_entity",
      status: "candidate",
      name: "Order",
      confidence: 0.7,
      evidence_refs: ["ev_ok"],
      endpoints: ["GET_api_example_test_orders"],
      identifier_fields: ["id"],
      relationships: [],
      unresolved_items: [],
      mermaid: "erDiagram\n  Order"
    }
  });
  await deps.facts.save({
    id: "fact_transition",
    project_id: "proj_demo",
    kind: "state_transition",
    evidence_refs: ["ev_ok"],
    pipeline_run_id: "run_state",
    created_at: "2026-06-26T00:00:00.000Z",
    data: {
      transition_id: "state_order_pending_approved",
      origin: "state-transition-inference",
      pipeline_run_id: "run_state",
      status: "candidate",
      entity_name: "Order",
      field: "status",
      from_state: "pending",
      to_state: "approved",
      transition_type: "observed",
      confidence: 0.65,
      evidence_refs: ["ev_ok"],
      unresolved_items: [],
      mermaid: "stateDiagram-v2\n  pending --> approved"
    }
  });
}

function httpEvidence(id: string, statusCode: number): Evidence {
  return {
    id,
    project_id: "proj_demo",
    source_id: "src_demo",
    kind: "http_exchange",
    schema_version: 1,
    observed_at: "2026-06-26T00:00:00.000Z",
    raw_ref: `${id}.json`,
    redaction_status: "redacted",
    summary: {
      type: "http_flow",
      method: "POST",
      url: "https://api.example.test/orders",
      scheme: "https",
      host: "api.example.test",
      path: "/orders",
      status_code: statusCode,
      request_headers: {},
      response_headers: {},
      content_type: "application/json",
      warnings: [],
      redactions: []
    }
  };
}
