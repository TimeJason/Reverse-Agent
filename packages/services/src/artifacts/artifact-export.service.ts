import type {
  Artifact,
  ArtifactStore,
  Fact,
  FactStore,
  PipelineRun,
  PipelineRunStore
} from "@software-analysis/core";
import { createId } from "@software-analysis/core";

import type { ApiEndpointData } from "../api/api-analysis.service.js";
import type {
  BusinessEntityData,
  StateTransitionData,
  WorkflowData
} from "../business/business-understanding.service.js";
import { redactSensitiveText } from "../evidence/text-redaction.js";

export interface ArtifactExportServiceDependencies {
  artifacts: ArtifactStore;
  facts: FactStore;
  pipelineRuns: PipelineRunStore;
  writeArtifact(path: string, content: string): Promise<string>;
}

export interface ExportArtifactInput {
  projectId: string;
  pipelineRunId?: string;
  format?: "json" | "yaml";
}

export interface ExportArtifactResult {
  artifact_id: string;
  path: string;
  warning_count: number;
  warnings: string[];
}

export class ArtifactExportService {
  constructor(private readonly deps: ArtifactExportServiceDependencies) {}

  async exportOpenApi(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const endpoints = await this.listEndpointFacts(input.projectId, input.pipelineRunId);
    const warnings = preflight(endpoints);
    const document = openApiDocument(endpoints);
    const format = input.format ?? "json";
    const content = format === "json" ? `${JSON.stringify(document, null, 2)}\n` : toYaml(document);
    const path = await this.deps.writeArtifact(`openapi-${String(Date.now())}.${format}`, content);
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "openapi",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        endpoint_count: endpoints.length,
        warning_count: warnings.length,
        format
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  async exportMarkdown(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const endpoints = await this.listEndpointFacts(input.projectId, input.pipelineRunId);
    const warnings = preflight(endpoints);
    const content = markdownDocument(endpoints, warnings);
    const path = await this.deps.writeArtifact(`api-docs-${String(Date.now())}.md`, content);
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "markdown",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        endpoint_count: endpoints.length,
        warning_count: warnings.length
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  async exportPostmanCollection(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const endpoints = await this.listEndpointFacts(input.projectId, input.pipelineRunId);
    const warnings = preflight(endpoints);
    const collection = postmanCollection(endpoints, warnings);
    const serialized = safeArtifactJson(collection, warnings);
    const path = await this.deps.writeArtifact(
      `postman-collection-${String(Date.now())}.json`,
      serialized
    );
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "postman",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        endpoint_count: endpoints.length,
        warning_count: warnings.length,
        format: "postman_collection_v2.1"
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  async exportSdkContext(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const endpoints = await this.listEndpointFacts(input.projectId, input.pipelineRunId);
    const workflows = await this.listLatestFacts<WorkflowData>(input.projectId, "workflow");
    const entities = await this.listLatestFacts<BusinessEntityData>(
      input.projectId,
      "business_entity"
    );
    const warnings = preflight(endpoints);
    const context = sdkContext(input.projectId, endpoints, workflows, entities, warnings);
    const serialized = safeArtifactJson(context, warnings);
    const path = await this.deps.writeArtifact(
      `sdk-context-${String(Date.now())}.json`,
      serialized
    );
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "sdk_context",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        endpoint_count: endpoints.length,
        workflow_count: workflows.length,
        entity_count: entities.length,
        warning_count: warnings.length
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  async exportWorkflowReport(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const workflows = await this.listLatestFacts<WorkflowData>(input.projectId, "workflow");
    const transitions = await this.listLatestFacts<StateTransitionData>(
      input.projectId,
      "state_transition"
    );
    const warnings = reportWarnings(workflows, "workflow");
    const format = input.format ?? "json";
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      project_id: input.projectId,
      workflows,
      state_transitions: transitions,
      unresolved_items: workflows.flatMap((workflow) => workflow.unresolved_items),
      warnings
    };
    const content =
      format === "yaml" ? workflowReportMarkdown(report) : safeArtifactJson(report, warnings);
    const path = await this.deps.writeArtifact(
      `workflow-report-${String(Date.now())}.${format === "yaml" ? "md" : "json"}`,
      content
    );
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "report",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        report_type: "workflow",
        workflow_count: workflows.length,
        state_transition_count: transitions.length,
        warning_count: warnings.length,
        format: format === "yaml" ? "markdown" : "json"
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  async exportEntityReport(input: ExportArtifactInput): Promise<ExportArtifactResult> {
    const entities = await this.listLatestFacts<BusinessEntityData>(
      input.projectId,
      "business_entity"
    );
    const transitions = await this.listLatestFacts<StateTransitionData>(
      input.projectId,
      "state_transition"
    );
    const warnings = reportWarnings(entities, "business_entity");
    const format = input.format ?? "json";
    const report = {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      project_id: input.projectId,
      entities,
      state_transitions: transitions,
      unresolved_items: entities.flatMap((entity) => entity.unresolved_items),
      warnings
    };
    const content =
      format === "yaml" ? entityReportMarkdown(report) : safeArtifactJson(report, warnings);
    const path = await this.deps.writeArtifact(
      `entity-report-${String(Date.now())}.${format === "yaml" ? "md" : "json"}`,
      content
    );
    const artifact = await this.deps.artifacts.save({
      id: createId("art"),
      project_id: input.projectId,
      kind: "report",
      artifact_schema_version: 1,
      path,
      finding_refs: [],
      ...(input.pipelineRunId === undefined ? {} : { pipeline_run_id: input.pipelineRunId }),
      metadata: {
        report_type: "entity",
        entity_count: entities.length,
        state_transition_count: transitions.length,
        warning_count: warnings.length,
        format: format === "yaml" ? "markdown" : "json"
      },
      created_at: new Date().toISOString()
    } satisfies Artifact);

    return {
      artifact_id: artifact.id,
      path: artifact.path,
      warning_count: warnings.length,
      warnings
    };
  }

  private async listEndpointFacts(
    projectId: string,
    pipelineRunId: string | undefined
  ): Promise<ApiEndpointData[]> {
    const facts = await this.deps.facts.listByProject(projectId);
    if (pipelineRunId !== undefined) {
      return facts
        .filter((fact) => fact.kind === "api_endpoint")
        .filter((fact) => fact.pipeline_run_id === pipelineRunId)
        .map((fact) => fact.data as ApiEndpointData)
        .sort(compareEndpoints);
    }

    const runs = await this.deps.pipelineRuns.listByProject(projectId);
    return latestEndpointData(facts, runs).sort(compareEndpoints);
  }

  private async listLatestFacts<T extends Record<string, unknown>>(
    projectId: string,
    kind: string
  ): Promise<T[]> {
    const facts = await this.deps.facts.listByProject(projectId);
    const runs = await this.deps.pipelineRuns.listByProject(projectId);
    return latestFactData<T>(facts, runs, kind);
  }
}

function openApiDocument(endpoints: ApiEndpointData[]): Record<string, unknown> {
  const servers = [
    ...new Set(
      endpoints.flatMap((endpoint) =>
        (endpoint.schemes.length === 0 ? ["https"] : endpoint.schemes).map(
          (scheme) => `${scheme}://${endpoint.host}`
        )
      )
    )
  ].map((url) => ({ url }));
  const paths: Record<string, Record<string, unknown>> = {};
  const securitySchemes: Record<string, unknown> = {};

  for (const endpoint of endpoints) {
    const path = endpoint.path_template.replaceAll("{id}", "{id}");
    const pathItem = paths[path] ?? {};
    const operation: Record<string, unknown> = {
      operationId: endpoint.endpoint_id,
      parameters: path.includes("{id}")
        ? [{ name: "id", in: "path", required: true, schema: { type: "string" } }]
        : [],
      responses: responsesFor(endpoint),
      "x-analysis": {
        confidence: endpoint.confidence,
        evidence_refs: endpoint.evidence_refs,
        warnings: endpoint.warnings
      }
    };

    if (endpoint.request_schema !== undefined) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: endpoint.request_schema
          }
        }
      };
    }

    if (endpoint.auth.required) {
      operation.security = endpoint.auth.schemes.map((scheme) => ({ [scheme]: [] }));
      for (const scheme of endpoint.auth.schemes) {
        securitySchemes[scheme] = securitySchemeFor(scheme);
      }
    }

    pathItem[endpoint.method.toLowerCase()] = operation;
    paths[path] = pathItem;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Analyzed API",
      version: "0.1.0"
    },
    servers,
    paths,
    components: {
      securitySchemes
    }
  };
}

function responsesFor(endpoint: ApiEndpointData): Record<string, unknown> {
  const entries = Object.entries(endpoint.response_schemas);
  if (entries.length === 0) {
    return {
      default: {
        description: "Observed response"
      }
    };
  }

  return Object.fromEntries(
    entries.map(([status, schema]) => [
      status,
      {
        description: `Observed ${status} response`,
        content: {
          "application/json": {
            schema
          }
        }
      }
    ])
  );
}

function securitySchemeFor(scheme: string): Record<string, unknown> {
  if (scheme === "cookie_session") {
    return { type: "apiKey", in: "cookie", name: "session" };
  }
  if (scheme === "api_key_query") {
    return { type: "apiKey", in: "query", name: "api_key" };
  }
  return { type: "http", scheme: "bearer" };
}

function markdownDocument(endpoints: ApiEndpointData[], warnings: string[]): string {
  const lines = ["# API 文档", "", `生成时间：${new Date().toISOString()}`, ""];

  if (warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const warning of warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Endpoints", "");
  for (const endpoint of endpoints) {
    lines.push(`### ${endpoint.method} ${endpoint.path_template}`, "");
    lines.push(`- Host: \`${endpoint.host}\``);
    lines.push(`- Samples: ${String(endpoint.sample_count)}`);
    lines.push(`- Confidence: ${String(endpoint.confidence)}`);
    lines.push(
      `- Auth: ${endpoint.auth.required ? endpoint.auth.schemes.join(", ") : "none observed"}`
    );
    lines.push(`- Evidence: ${endpoint.evidence_refs.map((ref) => `\`${ref}\``).join(", ")}`);
    lines.push("");
  }

  lines.push("## Workflow/Entity", "");
  lines.push("本阶段尚未执行业务流程、实体或状态机分析。", "");
  return lines.join("\n");
}

function postmanCollection(
  endpoints: ApiEndpointData[],
  warnings: string[]
): Record<string, unknown> {
  const folders = new Map<string, Record<string, unknown>[]>();
  for (const endpoint of endpoints) {
    const folderName = endpoint.host;
    const urlPath = endpoint.path_template
      .split("/")
      .filter((part) => part.length > 0)
      .map((part) => (part.startsWith("{") && part.endsWith("}") ? `:${part.slice(1, -1)}` : part));
    const item: Record<string, unknown> = {
      name: `${endpoint.method} ${endpoint.path_template}`,
      request: {
        method: endpoint.method,
        header: postmanHeaders(endpoint),
        url: {
          raw: `{{base_url}}/${urlPath.join("/")}`,
          host: ["{{base_url}}"],
          path: urlPath
        },
        auth: endpoint.auth.required
          ? {
              type: "bearer",
              bearer: [{ key: "token", value: "{{access_token}}", type: "string" }]
            }
          : undefined,
        body:
          endpoint.request_schema === undefined
            ? undefined
            : {
                mode: "raw",
                raw: JSON.stringify(exampleFromSchema(endpoint.request_schema), null, 2),
                options: { raw: { language: "json" } }
              }
      },
      event: [],
      response: [],
      _analysis: {
        confidence: endpoint.confidence,
        evidence_refs: endpoint.evidence_refs,
        warnings: endpoint.warnings
      }
    };
    folders.set(folderName, [...(folders.get(folderName) ?? []), item]);
  }

  return {
    info: {
      name: "Analyzed API",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    variable: [
      { key: "base_url", value: "https://example.invalid" },
      { key: "access_token", value: "" },
      { key: "entity_id", value: "" }
    ],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
    _analysis: {
      artifact: "postman",
      warning_count: warnings.length,
      warnings
    }
  };
}

function postmanHeaders(endpoint: ApiEndpointData): Record<string, string>[] {
  const headers = [{ key: "Accept", value: "application/json" }];
  if (endpoint.request_schema !== undefined) {
    headers.push({ key: "Content-Type", value: "application/json" });
  }
  return headers;
}

function sdkContext(
  projectId: string,
  endpoints: ApiEndpointData[],
  workflows: WorkflowData[],
  entities: BusinessEntityData[],
  warnings: string[]
): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    project_id: projectId,
    endpoints: endpoints.map((endpoint) => ({
      endpoint_id: endpoint.endpoint_id,
      method: endpoint.method,
      host: endpoint.host,
      path_template: endpoint.path_template,
      request_schema: endpoint.request_schema,
      response_schemas: endpoint.response_schemas,
      auth: endpoint.auth,
      evidence_refs: endpoint.evidence_refs,
      confidence: endpoint.confidence,
      warnings: endpoint.warnings
    })),
    workflows,
    entities,
    hints: {
      naming: namingHints(endpoints, entities),
      pagination: paginationHints(endpoints),
      error_handling: errorHandlingHints(endpoints)
    },
    warnings,
    evidence_refs: [...new Set(endpoints.flatMap((endpoint) => endpoint.evidence_refs))]
  };
}

function namingHints(endpoints: ApiEndpointData[], entities: BusinessEntityData[]): string[] {
  const entityHints = entities.map((entity) => `Prefer entity name ${entity.name}`);
  const endpointHints = endpoints.map(
    (endpoint) => `Use ${endpoint.endpoint_id} for ${endpoint.method} ${endpoint.path_template}`
  );
  return [...entityHints, ...endpointHints].slice(0, 50);
}

function paginationHints(endpoints: ApiEndpointData[]): string[] {
  const serialized = JSON.stringify(endpoints);
  if (/\b(page|limit|offset|cursor|next_cursor)\b/i.test(serialized)) {
    return ["Observed pagination-like fields; preserve cursor/limit naming from schemas."];
  }
  return ["No explicit pagination fields observed."];
}

function errorHandlingHints(endpoints: ApiEndpointData[]): string[] {
  const statuses = new Set(endpoints.flatMap((endpoint) => endpoint.status_codes));
  const clientErrors = [...statuses].filter((status) => status >= 400 && status < 500);
  const serverErrors = [...statuses].filter((status) => status >= 500);
  return [
    clientErrors.length > 0
      ? `Handle observed client errors: ${clientErrors.join(", ")}.`
      : "No client error responses observed.",
    serverErrors.length > 0
      ? `Handle observed server errors: ${serverErrors.join(", ")}.`
      : "No server error responses observed."
  ];
}

function workflowReportMarkdown(report: {
  generated_at: string;
  workflows: WorkflowData[];
  state_transitions: StateTransitionData[];
  unresolved_items: unknown[];
  warnings: string[];
}): string {
  const lines = ["# Workflow Report", "", `生成时间：${report.generated_at}`, ""];
  for (const workflow of report.workflows) {
    lines.push(`## ${workflow.name}`, "");
    lines.push(`- Status: ${workflow.status}`);
    lines.push(`- Confidence: ${String(workflow.confidence)}`);
    lines.push(`- Evidence: ${workflow.evidence_refs.map((ref) => `\`${ref}\``).join(", ")}`);
    lines.push("");
    lines.push("```mermaid", workflow.mermaid, "```", "");
  }
  lines.push(`Unresolved: ${String(report.unresolved_items.length)}`);
  lines.push(`Warnings: ${report.warnings.join(", ") || "none"}`, "");
  return lines.join("\n");
}

function entityReportMarkdown(report: {
  generated_at: string;
  entities: BusinessEntityData[];
  state_transitions: StateTransitionData[];
  unresolved_items: unknown[];
  warnings: string[];
}): string {
  const lines = ["# Entity Report", "", `生成时间：${report.generated_at}`, ""];
  for (const entity of report.entities) {
    lines.push(`## ${entity.name}`, "");
    lines.push(`- Status: ${entity.status}`);
    lines.push(`- Confidence: ${String(entity.confidence)}`);
    lines.push(`- Identifiers: ${entity.identifier_fields.join(", ") || "unknown"}`);
    lines.push(`- Evidence: ${entity.evidence_refs.map((ref) => `\`${ref}\``).join(", ")}`);
    lines.push("");
    lines.push("```mermaid", entity.mermaid, "```", "");
  }
  lines.push(`State transitions: ${String(report.state_transitions.length)}`);
  lines.push(`Unresolved: ${String(report.unresolved_items.length)}`);
  lines.push(`Warnings: ${report.warnings.join(", ") || "none"}`, "");
  return lines.join("\n");
}

function preflight(endpoints: ApiEndpointData[]): string[] {
  const warnings: string[] = [];
  if (endpoints.length === 0) {
    warnings.push("no_endpoints_detected");
  }
  const serialized = JSON.stringify(endpoints);
  if (redactSensitiveText(serialized).redacted) {
    warnings.push("sensitive_candidate_redacted_before_export");
  }
  return warnings;
}

function reportWarnings(items: unknown[], label: string): string[] {
  const warnings: string[] = [];
  if (items.length === 0) {
    warnings.push(`no_${label}_facts_detected`);
  }
  const serialized = JSON.stringify(items);
  if (redactSensitiveText(serialized).redacted) {
    warnings.push("sensitive_candidate_redacted_before_export");
  }
  return warnings;
}

function safeArtifactJson(value: unknown, warnings: string[]): string {
  const serialized = JSON.stringify(value, null, 2);
  if (redactSensitiveText(serialized).redacted) {
    warnings.push("sensitive_candidate_redacted_before_export");
  }
  return `${serialized}\n`;
}

function exampleFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(properties as Record<string, Record<string, unknown>>).map(([key, property]) => [
      key,
      exampleValue(key, property)
    ])
  );
}

function exampleValue(key: string, property: Record<string, unknown>): unknown {
  if (property.format === "uuid" || /_id$|^id$/i.test(key)) {
    return "{{entity_id}}";
  }
  if (property.type === "number" || property.type === "integer") {
    return 0;
  }
  if (property.type === "boolean") {
    return false;
  }
  if (property.type === "array") {
    return [];
  }
  if (property.type === "object") {
    return {};
  }
  return "string";
}

function toYaml(value: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => `${pad}- ${formatYamlValue(item, indent + 2)}`).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${pad}${key}: ${formatYamlValue(child, indent + 2)}`)
      .join("\n");
  }
  return `${pad}${String(value)}`;
}

function formatYamlValue(value: unknown, indent: number): string {
  if (typeof value === "object" && value !== null) {
    return `\n${toYaml(value, indent)}`;
  }
  return JSON.stringify(value);
}

function compareEndpoints(a: ApiEndpointData, b: ApiEndpointData): number {
  return `${a.host} ${a.path_template} ${a.method}`.localeCompare(
    `${b.host} ${b.path_template} ${b.method}`
  );
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

function latestFactData<T extends Record<string, unknown>>(
  facts: Fact[],
  runs: PipelineRun[],
  kind: string
): T[] {
  const runTimes = new Map(runs.map((run) => [run.id, run.finished_at ?? run.updated_at]));
  return facts
    .filter((fact) => fact.kind === kind)
    .sort((a, b) => compareFactsByAnalysisTime(a, b, runTimes))
    .map((fact) => fact.data as T);
}

function compareFactsByAnalysisTime(a: Fact, b: Fact, runTimes: Map<string, string>): number {
  return (
    analysisSequenceForFact(a) - analysisSequenceForFact(b) ||
    analysisTimeForFact(a, runTimes).localeCompare(analysisTimeForFact(b, runTimes)) ||
    a.created_at.localeCompare(b.created_at) ||
    a.id.localeCompare(b.id)
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
