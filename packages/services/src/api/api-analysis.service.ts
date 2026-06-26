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

import { redactSensitiveText } from "../evidence/text-redaction.js";

type JsonObject = Record<string, unknown>;
type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

export interface ApiAnalysisServiceDependencies {
  audit: AuditSink;
  evidence: EvidenceStore;
  facts: FactStore;
  findings: FindingStore;
  pipelineRuns: PipelineRunStore;
}

export interface AnalyzeApiSurfaceInput {
  projectId: string;
  captureSessionId?: string;
}

export interface AnalyzeApiSurfaceResult {
  pipeline_run_id: string;
  endpoint_count: number;
  fact_ids: string[];
  finding_ids: string[];
  warnings: string[];
}

export interface ApiEndpointData extends JsonObject {
  endpoint_id: string;
  host: string;
  schemes: string[];
  method: string;
  path_template: string;
  analysis_sequence: number;
  sample_count: number;
  evidence_refs: string[];
  status_codes: number[];
  content_types: string[];
  confidence: number;
  warnings: string[];
  request_schema?: JsonObject;
  response_schemas: Record<string, JsonObject>;
  auth: {
    required: boolean;
    schemes: string[];
    confidence: number;
    evidence_refs: string[];
  };
}

interface EndpointBucket {
  host: string;
  method: string;
  pathTemplate: string;
  flows: { evidence: Evidence; summary: HttpFlowSummary }[];
  warnings: string[];
}

export class ApiAnalysisService {
  constructor(private readonly deps: ApiAnalysisServiceDependencies) {}

  async analyzeApiSurface(input: AnalyzeApiSurfaceInput): Promise<AnalyzeApiSurfaceResult> {
    const now = new Date().toISOString();
    const flows = (await this.deps.evidence.listByProject(input.projectId))
      .filter((evidence) => evidence.kind === "http_exchange")
      .filter((evidence) => matchesCaptureSession(evidence, input.captureSessionId))
      .map((evidence) => ({ evidence, summary: evidence.summary as HttpFlowSummary }));

    const run = await this.saveRun({
      id: createId("run"),
      project_id: input.projectId,
      name: "api-surface",
      version: "0.1.0",
      status: "running",
      input_refs: flows.map((flow) => flow.evidence.id),
      output_ids: [],
      warnings: [],
      metrics: {},
      created_at: now,
      updated_at: now,
      started_at: now
    });

    const buckets = createEndpointBuckets(flows);
    const analysisSequence = await this.nextAnalysisSequence(input.projectId);
    const factIds: string[] = [];
    const findingIds: string[] = [];
    const warnings: string[] = [];

    for (const bucket of buckets) {
      const endpoint = endpointData(bucket, analysisSequence);
      warnings.push(...endpoint.warnings.map((warning) => `${endpoint.endpoint_id}:${warning}`));
      const fact: Fact = {
        id: createId("fact"),
        project_id: input.projectId,
        kind: "api_endpoint",
        data: endpoint,
        evidence_refs: endpoint.evidence_refs,
        pipeline_run_id: run.id,
        created_at: new Date().toISOString()
      };
      const finding: Finding = {
        id: createId("find"),
        project_id: input.projectId,
        kind: "api_endpoint",
        title: `${endpoint.method} ${endpoint.path_template}`,
        description: `Observed ${String(endpoint.sample_count)} HTTP sample(s) on ${endpoint.host}`,
        confidence: endpoint.confidence,
        evidence_refs: endpoint.evidence_refs,
        fact_refs: [fact.id],
        pipeline_run_id: run.id,
        data: {
          endpoint_id: endpoint.endpoint_id,
          host: endpoint.host,
          method: endpoint.method,
          path_template: endpoint.path_template
        },
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
      warnings,
      metrics: {
        endpoints: factIds.length,
        evidence: flows.length
      },
      updated_at: new Date().toISOString(),
      finished_at: new Date().toISOString()
    });

    return {
      pipeline_run_id: run.id,
      endpoint_count: factIds.length,
      fact_ids: factIds,
      finding_ids: findingIds,
      warnings
    };
  }

  async listEndpoints(projectId: string): Promise<ApiEndpointData[]> {
    const facts = await this.deps.facts.listByProject(projectId);
    const runs = await this.deps.pipelineRuns.listByProject(projectId);
    return latestEndpointData(facts, runs).sort(compareEndpoints);
  }

  async getEndpoint(projectId: string, endpointId: string): Promise<ApiEndpointData | null> {
    const endpoints = await this.listEndpoints(projectId);
    return endpoints.find((endpoint) => endpoint.endpoint_id === endpointId) ?? null;
  }

  private async saveRun(run: PipelineRun): Promise<PipelineRun> {
    const saved = await this.deps.pipelineRuns.save(run);
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: saved.project_id,
      actor: "service",
      action: `api_surface.${saved.status}`,
      target_type: "pipeline_run",
      target_id: saved.id,
      metadata: {
        status: saved.status,
        endpoint_count: saved.metrics.endpoints ?? 0
      },
      created_at: new Date().toISOString()
    });
    return saved;
  }

  private async nextAnalysisSequence(projectId: string): Promise<number> {
    const facts = await this.deps.facts.listByProject(projectId);
    const maxSequence = facts
      .filter((fact) => fact.kind === "api_endpoint")
      .map((fact) => (fact.data as Partial<ApiEndpointData>).analysis_sequence)
      .filter((sequence): sequence is number => typeof sequence === "number")
      .reduce((max, sequence) => Math.max(max, sequence), 0);
    return maxSequence + 1;
  }
}

function matchesCaptureSession(evidence: Evidence, captureSessionId: string | undefined): boolean {
  return captureSessionId === undefined || evidence.capture_session_id === captureSessionId;
}

function createEndpointBuckets(
  flows: { evidence: Evidence; summary: HttpFlowSummary }[]
): EndpointBucket[] {
  const buckets = new Map<string, EndpointBucket>();

  for (const flow of flows) {
    const normalized = normalizePath(flow.summary.path);
    const key = `${flow.summary.host}\n${flow.summary.method}\n${normalized.pathTemplate}`;
    const bucket = buckets.get(key) ?? {
      host: flow.summary.host,
      method: flow.summary.method,
      pathTemplate: normalized.pathTemplate,
      flows: [],
      warnings: [...normalized.warnings]
    };
    bucket.flows.push(flow);
    buckets.set(key, bucket);
  }

  return [...buckets.values()].sort((a, b) =>
    compareStrings(
      `${a.host} ${a.pathTemplate} ${a.method}`,
      `${b.host} ${b.pathTemplate} ${b.method}`
    )
  );
}

function endpointData(bucket: EndpointBucket, analysisSequence: number): ApiEndpointData {
  const evidenceRefs = bucket.flows.map((flow) => flow.evidence.id);
  const statusCodes = sortedNumbers(
    bucket.flows
      .map((flow) => flow.summary.status_code)
      .filter((status): status is number => status !== undefined)
  );
  const contentTypes = sortedStrings(
    bucket.flows
      .map((flow) => flow.summary.content_type)
      .filter((contentType): contentType is string => contentType !== undefined)
  );
  const schemes = sortedStrings(
    bucket.flows
      .map((flow) => flow.summary.scheme)
      .filter((scheme): scheme is string => scheme !== undefined)
  );
  const endpointId = endpointIdFor(bucket.host, bucket.method, bucket.pathTemplate);
  const requestSamples = bucket.flows
    .map((flow) => parseJsonPreview(flow.summary.request_body?.preview))
    .filter((value) => value !== undefined);
  const responses = new Map<string, JsonValue[]>();

  for (const flow of bucket.flows) {
    const status = String(flow.summary.status_code ?? "default");
    const body = parseJsonPreview(flow.summary.response_body?.preview);
    if (body === undefined) {
      continue;
    }
    responses.set(status, [...(responses.get(status) ?? []), body]);
  }

  const responseSchemas = Object.fromEntries(
    [...responses.entries()].map(([status, samples]) => [status, inferJsonSchema(samples)])
  );
  const auth = inferAuth(bucket);

  return {
    endpoint_id: endpointId,
    host: bucket.host,
    schemes,
    method: bucket.method,
    path_template: bucket.pathTemplate,
    analysis_sequence: analysisSequence,
    sample_count: bucket.flows.length,
    evidence_refs: evidenceRefs,
    status_codes: statusCodes,
    content_types: contentTypes,
    confidence: confidenceFor(bucket),
    warnings: bucket.warnings,
    ...(requestSamples.length === 0 ? {} : { request_schema: inferJsonSchema(requestSamples) }),
    response_schemas: responseSchemas,
    auth
  };
}

function normalizePath(path: string): { pathTemplate: string; warnings: string[] } {
  const warnings: string[] = [];
  const segments = path.split("/").map((segment) => {
    if (segment.length === 0) {
      return segment;
    }
    const decoded = decodePathSegment(segment);
    if (isSensitivePathSegment(decoded)) {
      warnings.push("sensitive_path_segment_redacted");
      return "{redacted}";
    }
    if (isIdLikeSegment(segment)) {
      warnings.push("path_parameter_inferred");
      return "{id}";
    }
    return segment;
  });
  const pathTemplate = segments.join("/") || "/";

  return { pathTemplate, warnings: sortedStrings(warnings) };
}

function isIdLikeSegment(segment: string): boolean {
  return (
    /^\d{2,}$/.test(segment) ||
    /^[0-9a-f]{24}$/i.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(segment)
  );
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isSensitivePathSegment(segment: string): boolean {
  return (
    redactSensitiveText(segment).redacted ||
    /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(segment) ||
    /(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|passwd|secret|session|jwt|token)/i.test(
      segment
    )
  );
}

function parseJsonPreview(preview: string | undefined): JsonValue | undefined {
  if (preview === undefined || preview.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(preview) as JsonValue;
  } catch {
    return undefined;
  }
}

function inferJsonSchema(samples: unknown[]): JsonObject {
  if (samples.length === 0) {
    return { type: "object" };
  }
  return schemaForValues(samples);
}

function schemaForValues(values: unknown[]): JsonObject {
  const nonUndefined = values.filter((value) => value !== undefined);
  const types = new Set(nonUndefined.map(jsonType));

  if (types.size > 1) {
    return {
      anyOf: [...types].sort().map((type) => ({ type }))
    };
  }

  const type = [...types][0] ?? "null";
  if (type === "object") {
    const objects = nonUndefined.filter(isObject);
    const keys = sortedStrings([...new Set(objects.flatMap((object) => Object.keys(object)))]);
    const properties: Record<string, JsonObject> = {};
    const required: string[] = [];

    for (const key of keys) {
      const presentValues = objects.filter((object) => key in object).map((object) => object[key]);
      properties[key] = schemaForValues(presentValues);
      if (presentValues.length === objects.length) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length === 0 ? {} : { required })
    };
  }

  if (type === "array") {
    const items = nonUndefined.filter(Array.isArray).flat();
    return {
      type: "array",
      items: items.length === 0 ? {} : schemaForValues(items)
    };
  }

  return { type };
}

function jsonType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inferAuth(bucket: EndpointBucket): ApiEndpointData["auth"] {
  const schemes = new Set<string>();
  const authEvidenceRefs: string[] = [];
  let hasAuthFailure = false;

  for (const flow of bucket.flows) {
    const headers = flow.summary.request_headers;
    if ("Authorization" in headers || "authorization" in headers) {
      schemes.add("bearer_or_basic");
      authEvidenceRefs.push(flow.evidence.id);
    }
    if ("Cookie" in headers || "cookie" in headers) {
      schemes.add("cookie_session");
      authEvidenceRefs.push(flow.evidence.id);
    }
    if (Object.keys(flow.summary.query ?? {}).some((key) => /api[_-]?key|token/i.test(key))) {
      schemes.add("api_key_query");
      authEvidenceRefs.push(flow.evidence.id);
    }
    if (flow.summary.status_code === 401 || flow.summary.status_code === 403) {
      hasAuthFailure = true;
      authEvidenceRefs.push(flow.evidence.id);
    }
  }

  return {
    required: schemes.size > 0 || hasAuthFailure,
    schemes: sortedStrings([...schemes]),
    confidence: schemes.size > 0 && hasAuthFailure ? 0.85 : schemes.size > 0 ? 0.7 : 0.3,
    evidence_refs: sortedStrings([...new Set(authEvidenceRefs)])
  };
}

function confidenceFor(bucket: EndpointBucket): number {
  return bucket.flows.length > 1 ? 0.9 : bucket.pathTemplate.includes("{id}") ? 0.75 : 0.65;
}

function endpointIdFor(host: string, method: string, pathTemplate: string): string {
  return `${method.toLowerCase()}_${host}_${pathTemplate}`
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function compareEndpoints(a: ApiEndpointData, b: ApiEndpointData): number {
  return compareStrings(
    `${a.host} ${a.path_template} ${a.method}`,
    `${b.host} ${b.path_template} ${b.method}`
  );
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function sortedStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function sortedNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function latestEndpointData(facts: Fact[], runs: PipelineRun[]): ApiEndpointData[] {
  const runTimes = new Map(runs.map((run) => [run.id, run.finished_at ?? run.updated_at]));
  const endpoints = new Map<string, ApiEndpointData>();

  for (const fact of facts
    .filter((candidate) => candidate.kind === "api_endpoint")
    .sort((a, b) => compareFactsByAnalysisTime(a, b, runTimes))) {
    const endpoint = fact.data as ApiEndpointData;
    endpoints.set(endpoint.endpoint_id, endpoint);
  }

  return [...endpoints.values()];
}

function compareFactsByAnalysisTime(a: Fact, b: Fact, runTimes: Map<string, string>): number {
  return (
    analysisSequenceForFact(a) - analysisSequenceForFact(b) ||
    compareStrings(analysisTimeForFact(a, runTimes), analysisTimeForFact(b, runTimes)) ||
    compareStrings(a.created_at, b.created_at) ||
    compareStrings(a.id, b.id)
  );
}

function analysisSequenceForFact(fact: Fact): number {
  const sequence = (fact.data as Partial<ApiEndpointData>).analysis_sequence;
  return typeof sequence === "number" ? sequence : 0;
}

function analysisTimeForFact(fact: Fact, runTimes: Map<string, string>): string {
  if (fact.pipeline_run_id !== undefined) {
    return runTimes.get(fact.pipeline_run_id) ?? fact.created_at;
  }
  return fact.created_at;
}
