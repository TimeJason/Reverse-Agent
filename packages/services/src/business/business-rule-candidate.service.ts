import type {
  AuditSink,
  Evidence,
  EvidenceStore,
  Fact,
  FactStore,
  Finding,
  FindingStore,
  HttpFlowSummary,
  PipelineRun,
  PipelineRunStore
} from "@software-analysis/core";
import { createId } from "@software-analysis/core";

type JsonObject = Record<string, unknown>;

export interface BusinessRuleCandidateServiceDependencies {
  audit: AuditSink;
  evidence: EvidenceStore;
  facts: FactStore;
  findings: FindingStore;
  pipelineRuns: PipelineRunStore;
}

export interface FindBusinessRuleCandidatesInput {
  projectId: string;
}

export interface FindBusinessRuleCandidatesResult {
  pipeline_run_id: string;
  candidate_count: number;
  fact_ids: string[];
  finding_ids: string[];
  unresolved_count: number;
  warnings: string[];
}

export interface BusinessRuleCandidateData extends JsonObject {
  rule_id: string;
  origin: "business-rule-candidate";
  status: "candidate";
  title: string;
  description: string;
  confidence: number;
  positive_evidence_refs: string[];
  counter_evidence_refs: string[];
  evidence_refs: string[];
  signals: {
    kind: string;
    detail: JsonObject;
    evidence_refs: string[];
  }[];
  unresolved_items: {
    reason: string;
    evidence_refs: string[];
    suggested_action: string;
  }[];
  pipeline_run_id: string;
}

export class BusinessRuleCandidateService {
  constructor(private readonly deps: BusinessRuleCandidateServiceDependencies) {}

  async findCandidates(
    input: FindBusinessRuleCandidatesInput
  ): Promise<FindBusinessRuleCandidatesResult> {
    const now = new Date().toISOString();
    const evidence = await this.deps.evidence.listByProject(input.projectId);
    const facts = await this.deps.facts.listByProject(input.projectId);
    const flows = evidence.filter(isHttpFlow);
    const run = await this.saveRun({
      id: createId("run"),
      project_id: input.projectId,
      name: "business-rule-candidates",
      version: "0.1.0",
      status: "running",
      input_refs: flows.map((flow) => flow.id),
      output_ids: [],
      warnings: [],
      metrics: {},
      created_at: now,
      updated_at: now,
      started_at: now
    });
    const candidates = [
      ...errorResponseCandidates(flows, run.id),
      ...stateTransitionCandidates(facts, run.id)
    ];
    const factIds: string[] = [];
    const findingIds: string[] = [];
    for (const candidate of candidates) {
      const fact: Fact = {
        id: createId("fact"),
        project_id: input.projectId,
        kind: "business_rule_candidate",
        data: candidate,
        evidence_refs: candidate.evidence_refs,
        pipeline_run_id: run.id,
        created_at: new Date().toISOString()
      };
      const finding: Finding = {
        id: createId("find"),
        project_id: input.projectId,
        kind: "business_rule_candidate",
        title: candidate.title,
        description: candidate.description,
        confidence: candidate.confidence,
        evidence_refs: candidate.evidence_refs,
        fact_refs: [fact.id],
        pipeline_run_id: run.id,
        data: candidate,
        created_at: new Date().toISOString()
      };
      await this.deps.facts.save(fact);
      await this.deps.findings.save(finding);
      factIds.push(fact.id);
      findingIds.push(finding.id);
    }

    await this.saveRun({
      ...run,
      status: "succeeded",
      output_ids: [...factIds, ...findingIds],
      metrics: {
        candidates: candidates.length,
        unresolved: candidates.reduce(
          (count, candidate) => count + candidate.unresolved_items.length,
          0
        )
      },
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString()
    });

    return {
      pipeline_run_id: run.id,
      candidate_count: candidates.length,
      fact_ids: factIds,
      finding_ids: findingIds,
      unresolved_count: candidates.reduce(
        (count, candidate) => count + candidate.unresolved_items.length,
        0
      ),
      warnings: candidates.length === 0 ? ["no_business_rule_candidates_detected"] : []
    };
  }

  async listCandidates(projectId: string): Promise<BusinessRuleCandidateData[]> {
    const facts = await this.deps.facts.listByProject(projectId);
    return facts
      .filter((fact) => fact.kind === "business_rule_candidate")
      .map((fact) => fact.data as BusinessRuleCandidateData);
  }

  private async saveRun(run: PipelineRun): Promise<PipelineRun> {
    const saved = await this.deps.pipelineRuns.save(run);
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: saved.project_id,
      actor: "service",
      action: `business_rule_candidates.${saved.status}`,
      target_type: "pipeline_run",
      target_id: saved.id,
      metadata: {
        status: saved.status,
        candidate_count: saved.metrics.candidates ?? 0
      },
      created_at: new Date().toISOString()
    });
    return saved;
  }
}

function isHttpFlow(evidence: Evidence): evidence is Evidence & { summary: HttpFlowSummary } {
  return evidence.kind === "http_exchange";
}

function errorResponseCandidates(
  flows: (Evidence & { summary: HttpFlowSummary })[],
  pipelineRunId: string
): BusinessRuleCandidateData[] {
  return flows
    .filter((flow) => (flow.summary.status_code ?? 0) >= 400)
    .map((flow) => ({
      rule_id: `rule_error_${flow.id}`,
      origin: "business-rule-candidate",
      status: "candidate",
      title: `Possible rejection rule for ${flow.summary.method} ${flow.summary.path}`,
      description:
        "Observed an error response. Treat this as a candidate business rule until counter examples are collected.",
      confidence:
        flow.summary.status_code !== undefined && flow.summary.status_code < 500 ? 0.55 : 0.4,
      positive_evidence_refs: [flow.id],
      counter_evidence_refs: [],
      evidence_refs: [flow.id],
      signals: [
        {
          kind: "error_response",
          detail: {
            method: flow.summary.method,
            path: flow.summary.path,
            status_code: flow.summary.status_code
          },
          evidence_refs: [flow.id]
        }
      ],
      unresolved_items: [
        {
          reason: "counter_evidence_missing",
          evidence_refs: [flow.id],
          suggested_action:
            "Capture a successful request for the same action and compare payload/state."
        }
      ],
      pipeline_run_id: pipelineRunId
    }));
}

function stateTransitionCandidates(
  facts: Fact[],
  pipelineRunId: string
): BusinessRuleCandidateData[] {
  return facts
    .filter((fact) => fact.kind === "state_transition")
    .map((fact) => {
      const data = fact.data;
      const fromState = typeof data.from_state === "string" ? data.from_state : "unknown";
      const toState = typeof data.to_state === "string" ? data.to_state : "unknown";
      const entity = typeof data.entity_name === "string" ? data.entity_name : "entity";
      return {
        rule_id: `rule_state_${fact.id}`,
        origin: "business-rule-candidate",
        status: "candidate",
        title: `Possible ${entity} lifecycle rule: ${fromState} -> ${toState}`,
        description:
          "Observed a state transition. This may indicate a lifecycle constraint, but it remains a candidate rule.",
        confidence: data.transition_type === "observed" ? 0.62 : 0.45,
        positive_evidence_refs: fact.evidence_refs,
        counter_evidence_refs: [],
        evidence_refs: fact.evidence_refs,
        signals: [
          {
            kind: "state_transition",
            detail: data,
            evidence_refs: fact.evidence_refs
          }
        ],
        unresolved_items: [
          {
            reason: "business_precondition_unknown",
            evidence_refs: fact.evidence_refs,
            suggested_action:
              "Collect counter examples and logs around rejected or skipped transitions."
          }
        ],
        pipeline_run_id: pipelineRunId
      } satisfies BusinessRuleCandidateData;
    });
}
