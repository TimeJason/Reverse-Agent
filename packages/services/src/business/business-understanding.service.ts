import type {
  AuditSink,
  BrowserEventSummary,
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

import type { ApiEndpointData } from "../api/api-analysis.service.js";

type JsonObject = Record<string, unknown>;
type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;
type OutputStatus = "accepted" | "candidate" | "unresolved";

export interface BusinessUnderstandingServiceDependencies {
  audit: AuditSink;
  evidence: EvidenceStore;
  facts: FactStore;
  findings: FindingStore;
  pipelineRuns: PipelineRunStore;
}

export interface AnalyzeBusinessInput {
  projectId: string;
  captureSessionId?: string;
}

export interface AnalyzeBusinessResult {
  pipeline_run_id: string;
  fact_ids: string[];
  finding_ids: string[];
  unresolved_count: number;
  warnings: string[];
}

export interface CorrelationData extends JsonObject {
  correlation_id: string;
  origin: "browser-flow-correlation";
  pipeline_run_id: string;
  status: OutputStatus;
  browser_event_id: string;
  flow_evidence_ids: string[];
  method: "request_id" | "url_time" | "submit_write" | "click_burst" | "unmatched";
  confidence: number;
  time_delta_ms?: number;
  evidence_refs: string[];
  unresolved_items: UnresolvedItem[];
}

export interface WorkflowData extends JsonObject {
  workflow_id: string;
  origin: "workflow-inference";
  status: OutputStatus;
  name: string;
  confidence: number;
  evidence_refs: string[];
  pipeline_run_id: string;
  steps: WorkflowStep[];
  unresolved_items: UnresolvedItem[];
  mermaid: string;
}

export interface WorkflowStep extends JsonObject {
  step_id: string;
  order: number;
  action: string;
  browser_event_id: string;
  flow_evidence_ids: string[];
  endpoint?: {
    method: string;
    host: string;
    path: string;
  };
  confidence: number;
  evidence_refs: string[];
}

export interface BusinessEntityData extends JsonObject {
  entity_id: string;
  origin: "business-entity-inference";
  pipeline_run_id: string;
  status: OutputStatus;
  name: string;
  confidence: number;
  evidence_refs: string[];
  endpoints: string[];
  identifier_fields: string[];
  relationships: EntityRelationship[];
  unresolved_items: UnresolvedItem[];
  mermaid: string;
}

export interface EntityRelationship extends JsonObject {
  target_entity: string;
  relation: "references" | "unknown";
  confidence: number;
  evidence_refs: string[];
}

export interface StateTransitionData extends JsonObject {
  transition_id: string;
  origin: "state-transition-inference";
  pipeline_run_id: string;
  status: OutputStatus;
  entity_name: string;
  entity_identifier?: string;
  field: string;
  from_state?: string;
  to_state: string;
  transition_type: "observed" | "inferred";
  confidence: number;
  trigger_endpoint?: {
    method: string;
    host: string;
    path: string;
  };
  evidence_refs: string[];
  unresolved_items: UnresolvedItem[];
  mermaid: string;
}

export interface UnresolvedItem extends JsonObject {
  reason: string;
  evidence_refs: string[];
  suggested_action: string;
}

interface BrowserEventRecord {
  evidence: Evidence;
  summary: BrowserEventSummary;
}

interface FlowRecord {
  evidence: Evidence;
  summary: HttpFlowSummary;
}

export class BusinessUnderstandingService {
  constructor(private readonly deps: BusinessUnderstandingServiceDependencies) {}

  async correlateBrowserEvents(input: AnalyzeBusinessInput): Promise<AnalyzeBusinessResult> {
    const now = new Date().toISOString();
    const browserEvents = await this.browserEvents(input);
    const flows = await this.flows(input);
    const run = await this.saveRun({
      id: createId("run"),
      project_id: input.projectId,
      name: "browser-flow-correlation",
      version: "0.1.0",
      status: "running",
      input_refs: [
        ...browserEvents.map((event) => event.evidence.id),
        ...flows.map((flow) => flow.evidence.id)
      ],
      output_ids: [],
      warnings: [],
      metrics: {},
      created_at: now,
      updated_at: now,
      started_at: now
    });
    const factIds: string[] = [];
    const findingIds: string[] = [];

    for (const event of browserEvents) {
      const correlation = correlateEvent(event, flows, run.id);
      const fact = await this.saveFact(
        input.projectId,
        "browser_flow_correlation",
        correlation,
        correlation.evidence_refs,
        run.id
      );
      factIds.push(fact.id);
      if (correlation.status !== "unresolved") {
        const finding = await this.saveFinding(
          input.projectId,
          "browser_flow_correlation",
          `Correlated ${event.summary.event_type} browser event`,
          correlation.confidence,
          correlation.evidence_refs,
          [fact.id],
          run.id,
          {
            correlation_id: correlation.correlation_id,
            method: correlation.method,
            status: correlation.status
          }
        );
        findingIds.push(finding.id);
      }
    }

    const unresolvedCount = factIds.length - findingIds.length;
    await this.saveRun({
      ...run,
      status: "succeeded",
      output_ids: [...factIds, ...findingIds],
      metrics: {
        correlations: factIds.length,
        unresolved: unresolvedCount
      },
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString()
    });

    return {
      pipeline_run_id: run.id,
      fact_ids: factIds,
      finding_ids: findingIds,
      unresolved_count: unresolvedCount,
      warnings: []
    };
  }

  async inferWorkflows(input: AnalyzeBusinessInput): Promise<AnalyzeBusinessResult> {
    const correlations = await this.latestCorrelations(input.projectId);
    const run = await this.startRun(
      input.projectId,
      "workflow-inference",
      correlations.flatMap((item) => item.evidence_refs)
    );
    const accepted = correlations.filter((item) => item.status !== "unresolved");
    const unresolved = correlations
      .filter((item) => item.status === "unresolved")
      .flatMap((item) => item.unresolved_items);
    const factIds: string[] = [];
    const findingIds: string[] = [];

    if (accepted.length > 0) {
      const workflow = workflowFromCorrelations(accepted, unresolved, run.id);
      const fact = await this.saveFact(
        input.projectId,
        "workflow",
        workflow,
        workflow.evidence_refs,
        run.id
      );
      const finding = await this.saveFinding(
        input.projectId,
        "workflow",
        workflow.name,
        workflow.confidence,
        workflow.evidence_refs,
        [fact.id],
        run.id,
        {
          workflow_id: workflow.workflow_id,
          status: workflow.status,
          step_count: workflow.steps.length
        }
      );
      factIds.push(fact.id);
      findingIds.push(finding.id);
    }

    await this.finishRun(run, factIds, findingIds, {
      workflows: factIds.length,
      unresolved: unresolved.length
    });
    return resultFor(run.id, factIds, findingIds, unresolved.length);
  }

  async inferBusinessEntities(input: AnalyzeBusinessInput): Promise<AnalyzeBusinessResult> {
    const facts = await this.deps.facts.listByProject(input.projectId);
    const endpoints = facts
      .filter((fact) => fact.kind === "api_endpoint")
      .map((fact) => fact.data as ApiEndpointData);
    const flows = await this.flows(input);
    const run = await this.startRun(input.projectId, "business-entity-inference", [
      ...facts.filter((fact) => fact.kind === "api_endpoint").flatMap((fact) => fact.evidence_refs),
      ...flows.map((flow) => flow.evidence.id)
    ]);
    const entities = inferEntities(endpoints, flows, run.id);
    const factIds: string[] = [];
    const findingIds: string[] = [];

    for (const entity of entities) {
      const fact = await this.saveFact(
        input.projectId,
        "business_entity",
        entity,
        entity.evidence_refs,
        run.id
      );
      const finding = await this.saveFinding(
        input.projectId,
        "business_entity",
        entity.name,
        entity.confidence,
        entity.evidence_refs,
        [fact.id],
        run.id,
        {
          entity_id: entity.entity_id,
          status: entity.status,
          endpoint_count: entity.endpoints.length
        }
      );
      factIds.push(fact.id);
      findingIds.push(finding.id);
    }

    await this.finishRun(run, factIds, findingIds, { entities: factIds.length });
    return resultFor(run.id, factIds, findingIds, 0);
  }

  async inferStateTransitions(input: AnalyzeBusinessInput): Promise<AnalyzeBusinessResult> {
    const flows = await this.flows(input);
    const run = await this.startRun(
      input.projectId,
      "state-transition-inference",
      flows.map((flow) => flow.evidence.id)
    );
    const transitions = inferStateTransitions(flows, run.id);
    const factIds: string[] = [];
    const findingIds: string[] = [];

    for (const transition of transitions) {
      const fact = await this.saveFact(
        input.projectId,
        "state_transition",
        transition,
        transition.evidence_refs,
        run.id
      );
      const finding = await this.saveFinding(
        input.projectId,
        "state_transition",
        `${transition.entity_name} ${transition.field}: ${transition.from_state ?? "unknown"} -> ${transition.to_state}`,
        transition.confidence,
        transition.evidence_refs,
        [fact.id],
        run.id,
        {
          transition_id: transition.transition_id,
          status: transition.status,
          transition_type: transition.transition_type
        }
      );
      factIds.push(fact.id);
      findingIds.push(finding.id);
    }

    const unresolvedCount = transitions.filter(
      (transition) => transition.status === "unresolved"
    ).length;
    await this.finishRun(run, factIds, findingIds, {
      transitions: factIds.length,
      unresolved: unresolvedCount
    });
    return resultFor(run.id, factIds, findingIds, unresolvedCount);
  }

  async listWorkflows(projectId: string): Promise<WorkflowData[]> {
    return this.listLatestFacts<WorkflowData>(projectId, "workflow", "workflow_id");
  }

  async getWorkflow(projectId: string, workflowId: string): Promise<WorkflowData | null> {
    const workflows = await this.listWorkflows(projectId);
    return workflows.find((workflow) => workflow.workflow_id === workflowId) ?? null;
  }

  async listBusinessEntities(projectId: string): Promise<BusinessEntityData[]> {
    return this.listLatestFacts<BusinessEntityData>(projectId, "business_entity", "entity_id");
  }

  async getBusinessEntity(projectId: string, entityId: string): Promise<BusinessEntityData | null> {
    const entities = await this.listBusinessEntities(projectId);
    return entities.find((entity) => entity.entity_id === entityId) ?? null;
  }

  async listStateTransitions(projectId: string): Promise<StateTransitionData[]> {
    return this.listLatestFacts<StateTransitionData>(
      projectId,
      "state_transition",
      "transition_id"
    );
  }

  private async latestCorrelations(projectId: string): Promise<CorrelationData[]> {
    return this.listLatestFacts<CorrelationData>(
      projectId,
      "browser_flow_correlation",
      "correlation_id"
    );
  }

  private async listLatestFacts<T extends JsonObject>(
    projectId: string,
    kind: string,
    key: keyof T
  ): Promise<T[]> {
    const facts = await this.deps.facts.listByProject(projectId);
    const latest = new Map<string, T>();
    for (const fact of facts
      .filter((candidate) => candidate.kind === kind)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
      const data = fact.data as T;
      latest.set(String(data[key]), data);
    }
    return [...latest.values()].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  }

  private async browserEvents(input: AnalyzeBusinessInput): Promise<BrowserEventRecord[]> {
    return (await this.deps.evidence.listByProject(input.projectId))
      .filter((evidence) => evidence.kind === "browser_event")
      .filter((evidence) => matchesCaptureSession(evidence, input.captureSessionId))
      .map((evidence) => ({ evidence, summary: evidence.summary as BrowserEventSummary }))
      .sort((a, b) => a.evidence.observed_at.localeCompare(b.evidence.observed_at));
  }

  private async flows(input: AnalyzeBusinessInput): Promise<FlowRecord[]> {
    return (await this.deps.evidence.listByProject(input.projectId))
      .filter((evidence) => evidence.kind === "http_exchange")
      .filter((evidence) => matchesCaptureSession(evidence, input.captureSessionId))
      .map((evidence) => ({ evidence, summary: evidence.summary as HttpFlowSummary }))
      .sort((a, b) => a.evidence.observed_at.localeCompare(b.evidence.observed_at));
  }

  private async startRun(
    projectId: string,
    name: string,
    inputRefs: string[]
  ): Promise<PipelineRun> {
    const now = new Date().toISOString();
    return this.saveRun({
      id: createId("run"),
      project_id: projectId,
      name,
      version: "0.1.0",
      status: "running",
      input_refs: sortedStrings(inputRefs),
      output_ids: [],
      warnings: [],
      metrics: {},
      created_at: now,
      updated_at: now,
      started_at: now
    });
  }

  private async finishRun(
    run: PipelineRun,
    factIds: string[],
    findingIds: string[],
    metrics: JsonObject
  ): Promise<void> {
    await this.saveRun({
      ...run,
      status: "succeeded",
      output_ids: [...factIds, ...findingIds],
      metrics,
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString()
    });
  }

  private async saveRun(run: PipelineRun): Promise<PipelineRun> {
    const saved = await this.deps.pipelineRuns.save(run);
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: saved.project_id,
      actor: "service",
      action: `${saved.name}.${saved.status}`,
      target_type: "pipeline_run",
      target_id: saved.id,
      metadata: {
        status: saved.status
      },
      created_at: new Date().toISOString()
    });
    return saved;
  }

  private async saveFact(
    projectId: string,
    kind: string,
    data: JsonObject,
    evidenceRefs: string[],
    pipelineRunId: string
  ): Promise<Fact> {
    return this.deps.facts.save({
      id: createId("fact"),
      project_id: projectId,
      kind,
      data,
      evidence_refs: sortedStrings(evidenceRefs),
      pipeline_run_id: pipelineRunId,
      created_at: new Date().toISOString()
    });
  }

  private async saveFinding(
    projectId: string,
    kind: string,
    title: string,
    confidence: number,
    evidenceRefs: string[],
    factRefs: string[],
    pipelineRunId: string,
    data: JsonObject
  ): Promise<Finding> {
    return this.deps.findings.save({
      id: createId("find"),
      project_id: projectId,
      kind,
      title,
      confidence,
      evidence_refs: sortedStrings(evidenceRefs),
      fact_refs: factRefs,
      pipeline_run_id: pipelineRunId,
      data,
      created_at: new Date().toISOString()
    });
  }
}

function correlateEvent(
  event: BrowserEventRecord,
  flows: FlowRecord[],
  pipelineRunId: string
): CorrelationData {
  const directRequestId = event.summary.related_request_id ?? event.summary.request_id;
  const byRequestId =
    directRequestId === undefined
      ? []
      : flows.filter((flow) => requestIdsFor(flow.summary).includes(directRequestId));
  if (byRequestId.length > 0) {
    return correlationData(event, byRequestId, "request_id", 0.98, pipelineRunId);
  }

  if (event.summary.event_type === "network" && event.summary.url !== undefined) {
    const byUrl = flows.filter((flow) => sameRequest(event.summary, flow.summary));
    if (byUrl.length > 0) {
      return correlationData(event, byUrl, "url_time", 0.9, pipelineRunId);
    }
  }

  if (event.summary.event_type === "submit") {
    const burst = writeBurstAfter(event, flows);
    if (burst.length > 0) {
      return correlationData(event, burst, "submit_write", 0.78, pipelineRunId);
    }
  }

  if (event.summary.event_type === "click") {
    const burst = writeBurstAfter(event, flows);
    if (burst.length > 0) {
      return correlationData(event, burst, "click_burst", 0.68, pipelineRunId);
    }
  }

  return {
    correlation_id: `corr_${event.evidence.id}`,
    origin: "browser-flow-correlation",
    pipeline_run_id: pipelineRunId,
    status: "unresolved",
    browser_event_id: event.evidence.id,
    flow_evidence_ids: [],
    method: "unmatched",
    confidence: 0.2,
    evidence_refs: [event.evidence.id],
    unresolved_items: [
      {
        reason: "no_matching_http_flow",
        evidence_refs: [event.evidence.id],
        suggested_action: "采集 request_id 或扩大浏览器事件与代理流量的时间窗口"
      }
    ]
  };
}

function correlationData(
  event: BrowserEventRecord,
  flows: FlowRecord[],
  method: CorrelationData["method"],
  confidence: number,
  pipelineRunId: string
): CorrelationData {
  const delta = Math.min(
    ...flows.map((flow) =>
      Math.abs(Date.parse(flow.evidence.observed_at) - Date.parse(event.evidence.observed_at))
    )
  );
  const evidenceRefs = [event.evidence.id, ...flows.map((flow) => flow.evidence.id)];
  return {
    correlation_id: `corr_${event.evidence.id}`,
    origin: "browser-flow-correlation",
    pipeline_run_id: pipelineRunId,
    status: confidence >= 0.75 ? "accepted" : "candidate",
    browser_event_id: event.evidence.id,
    flow_evidence_ids: flows.map((flow) => flow.evidence.id),
    method,
    confidence,
    time_delta_ms: delta,
    evidence_refs: evidenceRefs,
    unresolved_items: []
  };
}

function workflowFromCorrelations(
  correlations: CorrelationData[],
  unresolvedItems: UnresolvedItem[],
  pipelineRunId: string
): WorkflowData {
  const sorted = [...correlations].sort((a, b) =>
    a.browser_event_id.localeCompare(b.browser_event_id)
  );
  const steps = sorted.map((correlation, index) => workflowStep(correlation, index));
  const confidence = average(steps.map((step) => step.confidence));
  const status: OutputStatus = confidence >= 0.75 ? "accepted" : "candidate";
  const evidenceRefs = sortedStrings(sorted.flatMap((correlation) => correlation.evidence_refs));

  return {
    workflow_id: "workflow_observed_session",
    origin: "workflow-inference",
    status,
    name: "Observed Session Workflow",
    confidence,
    evidence_refs: evidenceRefs,
    pipeline_run_id: pipelineRunId,
    steps,
    unresolved_items: unresolvedItems,
    mermaid: workflowMermaid(steps)
  };
}

function workflowStep(correlation: CorrelationData, index: number): WorkflowStep {
  return {
    step_id: `step_${String(index + 1).padStart(2, "0")}`,
    order: index + 1,
    action: correlation.method,
    browser_event_id: correlation.browser_event_id,
    flow_evidence_ids: correlation.flow_evidence_ids,
    confidence: correlation.confidence,
    evidence_refs: correlation.evidence_refs
  };
}

function inferEntities(
  endpoints: ApiEndpointData[],
  flows: FlowRecord[],
  pipelineRunId: string
): BusinessEntityData[] {
  const buckets = new Map<
    string,
    { endpoints: Set<string>; evidenceRefs: Set<string>; ids: Set<string> }
  >();
  for (const endpoint of endpoints) {
    for (const name of entityNamesFromPath(endpoint.path_template)) {
      const bucket = buckets.get(name) ?? {
        endpoints: new Set<string>(),
        evidenceRefs: new Set<string>(),
        ids: new Set<string>()
      };
      bucket.endpoints.add(endpoint.endpoint_id);
      endpoint.evidence_refs.forEach((ref) => bucket.evidenceRefs.add(ref));
      identifierFields(endpoint).forEach((field) => bucket.ids.add(field));
      buckets.set(name, bucket);
    }
  }
  for (const flow of flows) {
    entityNamesFromPath(flow.summary.path).forEach((name) => {
      const bucket = buckets.get(name) ?? {
        endpoints: new Set<string>(),
        evidenceRefs: new Set<string>(),
        ids: new Set<string>()
      };
      bucket.evidenceRefs.add(flow.evidence.id);
      Object.keys(jsonObjectFromPreview(flow.summary.response_body?.preview) ?? {})
        .filter((key) => /(^id$|_id$|Id$)/.test(key))
        .forEach((key) => bucket.ids.add(key));
      buckets.set(name, bucket);
    });
  }

  return [...buckets.entries()]
    .map(([name, bucket]) => {
      const evidenceRefs = sortedStrings([...bucket.evidenceRefs]);
      const identifierFields = sortedStrings([...bucket.ids]);
      const confidence = identifierFields.length > 0 ? 0.82 : 0.64;
      const status: OutputStatus = confidence >= 0.75 ? "accepted" : "candidate";
      const relationships = relationshipsFor(name, buckets, evidenceRefs);
      return {
        entity_id: `entity_${slug(name)}`,
        origin: "business-entity-inference",
        pipeline_run_id: pipelineRunId,
        status,
        name,
        confidence,
        evidence_refs: evidenceRefs,
        endpoints: sortedStrings([...bucket.endpoints]),
        identifier_fields: identifierFields,
        relationships,
        unresolved_items:
          identifierFields.length === 0
            ? [
                {
                  reason: "identifier_field_not_observed",
                  evidence_refs: evidenceRefs,
                  suggested_action: "补充包含实体 id 字段的响应样本"
                }
              ]
            : [],
        mermaid: entityMermaid(name, relationships)
      } satisfies BusinessEntityData;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inferStateTransitions(flows: FlowRecord[], pipelineRunId: string): StateTransitionData[] {
  const observations = flows.flatMap(stateObservationsFromFlow);
  const grouped = groupBy(
    observations,
    (item) => `${item.entityName}:${item.identifier}:${item.field}`
  );
  const transitions: StateTransitionData[] = [];

  for (const group of grouped.values()) {
    const sorted = group.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const previous = sorted[index - 1];
      if (current === undefined) {
        continue;
      }
      const observed = previous !== undefined && previous.state !== current.state;
      transitions.push({
        transition_id: `transition_${slug(current.entityName)}_${slug(current.identifier)}_${String(index + 1)}`,
        origin: "state-transition-inference",
        pipeline_run_id: pipelineRunId,
        status: observed ? "accepted" : "candidate",
        entity_name: current.entityName,
        entity_identifier: current.identifier,
        field: current.field,
        ...(observed ? { from_state: previous.state } : {}),
        to_state: current.state,
        transition_type: observed ? "observed" : "inferred",
        confidence: observed ? 0.86 : 0.58,
        ...(current.endpoint === undefined ? {} : { trigger_endpoint: current.endpoint }),
        evidence_refs: [current.evidenceRef],
        unresolved_items: observed
          ? []
          : [
              {
                reason: "only_result_state_observed",
                evidence_refs: [current.evidenceRef],
                suggested_action: "采集同一实体的前置状态或操作前查询"
              }
            ],
        mermaid: stateMermaid(previous?.state, current.state)
      });
    }
  }

  return transitions;
}

interface StateObservation {
  entityName: string;
  identifier: string;
  field: string;
  state: string;
  observedAt: string;
  evidenceRef: string;
  endpoint: StateTransitionData["trigger_endpoint"];
}

function stateObservationsFromFlow(flow: FlowRecord): StateObservation[] {
  const body = jsonObjectFromPreview(flow.summary.response_body?.preview);
  if (body === undefined) {
    return [];
  }
  const stateEntry = Object.entries(body).find(
    ([key, value]) =>
      /(^status$|^state$|phase|stage|_status$)/i.test(key) && typeof value === "string"
  );
  if (stateEntry === undefined) {
    return [];
  }
  const idEntry = Object.entries(body).find(
    ([key, value]) => /(^id$|_id$|Id$)/.test(key) && typeof value === "string"
  );
  const entityName = entityNamesFromPath(flow.summary.path)[0] ?? "Unknown";
  const identifier = typeof idEntry?.[1] === "string" ? idEntry[1] : `${entityName}:unknown`;
  return [
    {
      entityName,
      identifier,
      field: stateEntry[0],
      state: String(stateEntry[1]),
      observedAt: flow.evidence.observed_at,
      evidenceRef: flow.evidence.id,
      endpoint: {
        method: flow.summary.method,
        host: flow.summary.host,
        path: flow.summary.path
      }
    }
  ];
}

function requestIdsFor(summary: HttpFlowSummary): string[] {
  return sortedStrings(
    [
      summary.request_headers["x-request-id"],
      summary.request_headers["X-Request-Id"],
      summary.response_headers["x-request-id"],
      summary.response_headers["X-Request-Id"]
    ].filter((value): value is string => value !== undefined)
  );
}

function sameRequest(event: BrowserEventSummary, flow: HttpFlowSummary): boolean {
  return (
    event.url === flow.url &&
    (event.method === undefined || event.method.toUpperCase() === flow.method.toUpperCase())
  );
}

function writeBurstAfter(event: BrowserEventRecord, flows: FlowRecord[]): FlowRecord[] {
  const eventTime = Date.parse(event.evidence.observed_at);
  return flows.filter((flow) => {
    const delta = Date.parse(flow.evidence.observed_at) - eventTime;
    return delta >= 0 && delta <= 3000 && /^(POST|PUT|PATCH|DELETE)$/i.test(flow.summary.method);
  });
}

function entityNamesFromPath(path: string): string[] {
  return sortedStrings(
    path
      .split("/")
      .filter((segment) => /^[A-Za-z][A-Za-z0-9_-]+$/.test(segment))
      .filter((segment) => !/^v\d+$/i.test(segment))
      .map((segment) => singularTitle(segment))
  );
}

function identifierFields(endpoint: ApiEndpointData): string[] {
  const schemas = [endpoint.request_schema, ...Object.values(endpoint.response_schemas)].filter(
    (schema): schema is JsonObject => schema !== undefined
  );
  return sortedStrings(schemas.flatMap((schema) => identifierFieldsFromSchema(schema)));
}

function identifierFieldsFromSchema(schema: JsonObject): string[] {
  const properties = schema.properties;
  if (!isObject(properties)) {
    return [];
  }
  return Object.keys(properties).filter((key) => /(^id$|_id$|Id$)/.test(key));
}

function relationshipsFor(
  name: string,
  buckets: Map<string, { endpoints: Set<string>; evidenceRefs: Set<string>; ids: Set<string> }>,
  evidenceRefs: string[]
): EntityRelationship[] {
  return [...buckets.keys()]
    .filter((candidate) => candidate !== name)
    .filter((candidate) => candidate.includes(name) || name.includes(candidate))
    .map((candidate) => ({
      target_entity: candidate,
      relation: "references",
      confidence: 0.55,
      evidence_refs: evidenceRefs
    }));
}

function jsonObjectFromPreview(preview: string | undefined): JsonObject | undefined {
  if (preview === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(preview) as JsonValue;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function workflowMermaid(steps: WorkflowStep[]): string {
  const lines = ["flowchart TD"];
  for (const step of steps) {
    lines.push(`  ${step.step_id}["${step.action}"]`);
  }
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const current = steps[index];
    if (previous !== undefined && current !== undefined) {
      lines.push(`  ${previous.step_id} --> ${current.step_id}`);
    }
  }
  return lines.join("\n");
}

function entityMermaid(name: string, relationships: EntityRelationship[]): string {
  const lines = ["flowchart LR", `  ${slug(name)}["${name}"]`];
  for (const relationship of relationships) {
    lines.push(
      `  ${slug(name)} --> ${slug(relationship.target_entity)}["${relationship.target_entity}"]`
    );
  }
  return lines.join("\n");
}

function stateMermaid(from: string | undefined, to: string): string {
  return `stateDiagram-v2\n  [*] --> ${slug(from ?? "unknown")}\n  ${slug(from ?? "unknown")} --> ${slug(to)}`;
}

function resultFor(
  pipelineRunId: string,
  factIds: string[],
  findingIds: string[],
  unresolvedCount: number
): AnalyzeBusinessResult {
  return {
    pipeline_run_id: pipelineRunId,
    fact_ids: factIds,
    finding_ids: findingIds,
    unresolved_count: unresolvedCount,
    warnings: []
  };
}

function matchesCaptureSession(evidence: Evidence, captureSessionId: string | undefined): boolean {
  return captureSessionId === undefined || evidence.capture_session_id === captureSessionId;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function singularTitle(value: string): string {
  const normalized = value.replace(/[-_]+/g, " ");
  const singular = normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
  return singular.replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(/\s+/g, "");
}

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function sortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  }
  return groups;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
