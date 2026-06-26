import { z } from "zod";

import { RedactionPolicySchema, createId } from "@software-analysis/core";
import { createDefaultRedactionPolicy } from "@software-analysis/services";

import type { SoftwareAnalysisMcpContext } from "./context.js";
import { failure, normalizeError, serializeToolResult, success } from "./envelope.js";

type ToolHandler<TOutput> = (input: Record<string, unknown>) => Promise<TOutput>;

export interface ToolDefinition<TOutput = unknown> {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: ToolHandler<TOutput>;
}

export function createToolDefinitions(ctx: SoftwareAnalysisMcpContext): ToolDefinition[] {
  return [
    {
      name: "get_project_status",
      title: "Get project status",
      description: "Return the current project status for this MCP session.",
      inputSchema: z.object({}),
      handler: async () => ctx.projectService.getProjectStatus(ctx.projectId)
    },
    {
      name: "list_capture_sessions",
      title: "List capture sessions",
      description: "List capture sessions for the current project.",
      inputSchema: z.object({}),
      handler: async () => ctx.captureSessions.listByProject(ctx.projectId)
    },
    {
      name: "start_capture_session",
      title: "Start capture session",
      description:
        "Create a local capture session lifecycle record. Live mitmproxy/Playwright providers are not attached in this build.",
      inputSchema: z.object({
        name: z.string().optional(),
        mode: z.enum(["proxy_only", "browser_assisted", "manual"]).default("proxy_only"),
        proxy: z
          .object({
            host: z.string().optional(),
            port: z.number().int().min(0).max(65535).optional()
          })
          .optional(),
        browser: z
          .object({
            enabled: z.boolean().optional(),
            start_url: z.string().optional(),
            headless: z.boolean().optional()
          })
          .optional(),
        filters: z
          .object({
            include_hosts: z.array(z.string()).optional(),
            exclude_hosts: z.array(z.string()).optional(),
            include_paths: z.array(z.string()).optional(),
            exclude_paths: z.array(z.string()).optional()
          })
          .optional()
      }),
      handler: async (input) =>
        ctx.captureSessionService.start({
          projectId: ctx.projectId,
          mode:
            input.mode === "browser_assisted" || input.mode === "manual"
              ? input.mode
              : "proxy_only",
          ...(typeof input.name === "string" ? { name: input.name } : {}),
          ...(typeof input.proxy === "object" && input.proxy !== null
            ? { proxy: input.proxy }
            : {}),
          ...(typeof input.browser === "object" && input.browser !== null
            ? { browser: input.browser }
            : {}),
          ...(typeof input.filters === "object" && input.filters !== null
            ? { filters: input.filters }
            : {})
        })
    },
    {
      name: "stop_capture_session",
      title: "Stop capture session",
      description: "Stop a local capture session lifecycle record.",
      inputSchema: z.object({
        capture_session_id: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.captureSessionService.stop(ctx.projectId, stringInput(input, "capture_session_id"))
    },
    {
      name: "get_capture_status",
      title: "Get capture status",
      description: "Return status for one local capture session.",
      inputSchema: z.object({
        capture_session_id: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.captureSessionService.getStatus(ctx.projectId, stringInput(input, "capture_session_id"))
    },
    {
      name: "get_redaction_policy",
      title: "Get redaction policy",
      description: "Return the active redaction policy or the default policy.",
      inputSchema: z.object({}),
      handler: async () => {
        const active = await ctx.redactionPolicies?.getActiveForProject(ctx.projectId);
        if (active !== undefined && active !== null) {
          return active;
        }
        const fallback = createDefaultRedactionPolicy(ctx.projectId);
        return {
          project_id: fallback.project_id,
          mode: fallback.mode,
          rules: fallback.rules
        };
      }
    },
    {
      name: "configure_redaction",
      title: "Configure redaction",
      description: "Create a new redaction policy version for the current project.",
      inputSchema: z.object({
        mode: z.enum(["default", "strict", "custom"]).default("custom"),
        rules: z.array(z.string().min(1)).min(1)
      }),
      handler: async (input) => {
        if (ctx.redactionPolicies === undefined) {
          throw new Error("Redaction policy store is not available.");
        }
        const active = await ctx.redactionPolicies.getActiveForProject(ctx.projectId);
        const policy = RedactionPolicySchema.parse({
          id: createId("policy"),
          project_id: ctx.projectId,
          version: (active?.version ?? 0) + 1,
          mode: input.mode,
          rules: input.rules,
          created_at: new Date().toISOString()
        });
        await ctx.redactionPolicies.save(policy);
        return policy;
      }
    },
    {
      name: "list_artifacts",
      title: "List artifacts",
      description: "List generated artifacts for the current project.",
      inputSchema: z.object({}),
      handler: async () =>
        ctx.artifacts === undefined ? [] : ctx.artifacts.listByProject(ctx.projectId)
    },
    {
      name: "import_har",
      title: "Import HAR",
      description: "Import a local HAR file into the current project.",
      inputSchema: z.object({
        file_path: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.evidenceImportService.import({
          projectId: ctx.projectId,
          provider: ctx.providers.har,
          content: await ctx.readFile(stringInput(input, "file_path")),
          uri: stringInput(input, "file_path"),
          mediaType: "application/json"
        })
    },
    {
      name: "import_logs",
      title: "Import logs",
      description: "Import JSONL, nginx access log, or generic logs into the current project.",
      inputSchema: z.object({
        file_path: z.string().min(1),
        format: z.enum(["jsonl", "nginx", "generic"]).default("jsonl"),
        service: z.string().optional()
      }),
      handler: async (input) =>
        ctx.evidenceImportService.import({
          projectId: ctx.projectId,
          provider: ctx.providers.logs,
          content: await ctx.readFile(stringInput(input, "file_path")),
          uri: stringInput(input, "file_path"),
          mediaType: "text/plain",
          options: definedRecord({ format: input.format, service: input.service })
        })
    },
    {
      name: "import_mitmproxy_dump",
      title: "Import mitmproxy dump",
      description: "Import a mitmproxy dump file when the worker parser supports the dump version.",
      inputSchema: z.object({
        file_path: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.evidenceImportService.import({
          projectId: ctx.projectId,
          provider: ctx.providers.mitmproxy,
          content: await ctx.readFile(stringInput(input, "file_path")),
          uri: stringInput(input, "file_path"),
          mediaType: "application/octet-stream"
        })
    },
    {
      name: "import_browser_events",
      title: "Import browser events",
      description: "Import redacted Playwright/browser event JSONL into the current project.",
      inputSchema: z.object({
        file_path: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.evidenceImportService.import({
          projectId: ctx.projectId,
          provider: ctx.providers.browser,
          content: await ctx.readFile(stringInput(input, "file_path")),
          uri: stringInput(input, "file_path"),
          mediaType: "application/x-ndjson"
        })
    },
    {
      name: "search_traffic",
      title: "Search traffic",
      description: "Search redacted HTTP flow evidence in the current project.",
      inputSchema: z.object({
        host: z.string().optional(),
        method: z.string().optional(),
        path_contains: z.string().optional(),
        status_code: z.number().int().optional(),
        status_min: z.number().int().optional(),
        status_max: z.number().int().optional(),
        content_type: z.string().optional(),
        capture_session_id: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional()
      }),
      handler: async (input) =>
        ctx.evidenceQueryService.searchTraffic({
          project_id: ctx.projectId,
          ...definedRecord(input)
        })
    },
    {
      name: "get_request",
      title: "Get request",
      description: "Get one redacted HTTP flow evidence item by evidence id.",
      inputSchema: z.object({
        evidence_id: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.evidenceQueryService.getRequest(ctx.projectId, stringInput(input, "evidence_id"))
    },
    {
      name: "list_hosts",
      title: "List hosts",
      description: "List hosts observed in redacted HTTP flow evidence.",
      inputSchema: z.object({}),
      handler: async () => ctx.evidenceQueryService.listHosts(ctx.projectId)
    },
    {
      name: "search_logs",
      title: "Search logs",
      description: "Search redacted log evidence in the current project.",
      inputSchema: z.object({
        level: z.string().optional(),
        service: z.string().optional(),
        trace_id: z.string().optional(),
        request_id: z.string().optional(),
        message_contains: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional()
      }),
      handler: async (input) =>
        ctx.evidenceQueryService.searchLogs({
          project_id: ctx.projectId,
          ...definedRecord(input)
        })
    },
    {
      name: "scan_sensitive_data",
      title: "Scan sensitive data",
      description:
        "Report whether redacted evidence summaries still contain obvious secret markers.",
      inputSchema: z.object({}),
      handler: async () => {
        const traffic = await ctx.evidenceQueryService.searchTraffic({
          project_id: ctx.projectId,
          limit: 200
        });
        const logs = await ctx.evidenceQueryService.searchLogs({
          project_id: ctx.projectId,
          limit: 200
        });
        const serialized = JSON.stringify([...traffic.items, ...logs.items]);
        return {
          scanned: traffic.items.length + logs.items.length,
          leaks_detected:
            /Bearer\s+[A-Za-z0-9._~+/=-]+/i.test(serialized) ||
            /\b(access_token|refresh_token|api[_-]?key|password|secret)=((?!\[REDACTED).)+/i.test(
              serialized
            )
        };
      }
    },
    {
      name: "analyze_api_surface",
      title: "Analyze API surface",
      description:
        "Infer endpoint inventory, JSON schemas, and auth hints from redacted HTTP evidence.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.apiAnalysisService.analyzeApiSurface({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "infer_endpoints",
      title: "Infer endpoints",
      description: "Run endpoint inventory inference through the API surface pipeline.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.apiAnalysisService.analyzeApiSurface({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "infer_schemas",
      title: "Infer schemas",
      description: "Run request and response schema inference through the API surface pipeline.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.apiAnalysisService.analyzeApiSurface({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "infer_auth",
      title: "Infer auth",
      description: "Run auth hint inference through the API surface pipeline.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.apiAnalysisService.analyzeApiSurface({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "list_endpoints",
      title: "List endpoints",
      description: "List inferred API endpoints for the current project.",
      inputSchema: z.object({}),
      handler: async () => ctx.apiAnalysisService.listEndpoints(ctx.projectId)
    },
    {
      name: "get_endpoint",
      title: "Get endpoint",
      description: "Get one inferred API endpoint by endpoint id.",
      inputSchema: z.object({
        endpoint_id: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.apiAnalysisService.getEndpoint(ctx.projectId, stringInput(input, "endpoint_id"))
    },
    {
      name: "export_openapi",
      title: "Export OpenAPI",
      description: "Export inferred API surface as OpenAPI 3.1 JSON or YAML artifact.",
      inputSchema: z.object({
        format: z.enum(["json", "yaml"]).default("json"),
        pipeline_run_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.artifactExportService.exportOpenApi({
          projectId: ctx.projectId,
          format: input.format === "yaml" ? "yaml" : "json",
          ...(typeof input.pipeline_run_id === "string"
            ? { pipelineRunId: input.pipeline_run_id }
            : {})
        })
    },
    {
      name: "export_markdown_docs",
      title: "Export Markdown API docs",
      description: "Export inferred API surface as Markdown documentation artifact.",
      inputSchema: z.object({
        pipeline_run_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.artifactExportService.exportMarkdown({
          projectId: ctx.projectId,
          ...(typeof input.pipeline_run_id === "string"
            ? { pipelineRunId: input.pipeline_run_id }
            : {})
        })
    },
    {
      name: "export_postman_collection",
      title: "Export Postman collection",
      description: "Export inferred API surface as a Postman Collection artifact.",
      inputSchema: z.object({
        pipeline_run_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.artifactExportService.exportPostmanCollection({
          projectId: ctx.projectId,
          ...(typeof input.pipeline_run_id === "string"
            ? { pipelineRunId: input.pipeline_run_id }
            : {})
        })
    },
    {
      name: "export_sdk_context",
      title: "Export SDK context",
      description:
        "Export code-generation context with endpoints, workflows, entities, hints, and evidence refs.",
      inputSchema: z.object({
        pipeline_run_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.artifactExportService.exportSdkContext({
          projectId: ctx.projectId,
          ...(typeof input.pipeline_run_id === "string"
            ? { pipelineRunId: input.pipeline_run_id }
            : {})
        })
    },
    {
      name: "export_workflow_report",
      title: "Export workflow report",
      description: "Export workflow and state transition report as JSON or Markdown artifact.",
      inputSchema: z.object({
        format: z.enum(["json", "markdown"]).default("json")
      }),
      handler: async (input) =>
        ctx.artifactExportService.exportWorkflowReport({
          projectId: ctx.projectId,
          format: input.format === "markdown" ? "yaml" : "json"
        })
    },
    {
      name: "export_entity_report",
      title: "Export entity report",
      description: "Export entity model and state transition report as JSON or Markdown artifact.",
      inputSchema: z.object({
        format: z.enum(["json", "markdown"]).default("json")
      }),
      handler: async (input) =>
        ctx.artifactExportService.exportEntityReport({
          projectId: ctx.projectId,
          format: input.format === "markdown" ? "yaml" : "json"
        })
    },
    {
      name: "correlate_browser_events",
      title: "Correlate browser events",
      description: "Correlate browser events with HTTP flow evidence.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.businessUnderstandingService.correlateBrowserEvents({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "infer_workflows",
      title: "Infer workflows",
      description: "Infer L2 workflow candidates from browser-flow correlations.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.businessUnderstandingService.inferWorkflows({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "list_workflows",
      title: "List workflows",
      description: "List inferred workflow candidates for the current project.",
      inputSchema: z.object({}),
      handler: async () => ctx.businessUnderstandingService.listWorkflows(ctx.projectId)
    },
    {
      name: "get_workflow",
      title: "Get workflow",
      description: "Get one inferred workflow by workflow id.",
      inputSchema: z.object({
        workflow_id: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.businessUnderstandingService.getWorkflow(
          ctx.projectId,
          stringInput(input, "workflow_id")
        )
    },
    {
      name: "infer_business_entities",
      title: "Infer business entities",
      description: "Infer L3 business entity candidates from endpoints and flows.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.businessUnderstandingService.inferBusinessEntities({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "list_business_entities",
      title: "List business entities",
      description: "List inferred business entity candidates for the current project.",
      inputSchema: z.object({}),
      handler: async () => ctx.businessUnderstandingService.listBusinessEntities(ctx.projectId)
    },
    {
      name: "get_business_entity",
      title: "Get business entity",
      description: "Get one inferred business entity by entity id.",
      inputSchema: z.object({
        entity_id: z.string().min(1)
      }),
      handler: async (input) =>
        ctx.businessUnderstandingService.getBusinessEntity(
          ctx.projectId,
          stringInput(input, "entity_id")
        )
    },
    {
      name: "infer_state_transitions",
      title: "Infer state transitions",
      description: "Infer observed or candidate state transitions from flow evidence.",
      inputSchema: z.object({
        capture_session_id: z.string().optional()
      }),
      handler: async (input) =>
        ctx.businessUnderstandingService.inferStateTransitions({
          projectId: ctx.projectId,
          ...(typeof input.capture_session_id === "string"
            ? { captureSessionId: input.capture_session_id }
            : {})
        })
    },
    {
      name: "list_state_transitions",
      title: "List state transitions",
      description: "List inferred state transitions for the current project.",
      inputSchema: z.object({}),
      handler: async () => ctx.businessUnderstandingService.listStateTransitions(ctx.projectId)
    },
    {
      name: "find_business_rule_candidates",
      title: "Find business rule candidates",
      description:
        "Find conservative L4 candidate business rules from evidence and state transitions.",
      inputSchema: z.object({}),
      handler: async () =>
        ctx.businessRuleCandidateService.findCandidates({
          projectId: ctx.projectId
        })
    },
    {
      name: "list_business_rule_candidates",
      title: "List business rule candidates",
      description: "List L4 candidate business rules. These are never accepted facts.",
      inputSchema: z.object({}),
      handler: async () => ctx.businessRuleCandidateService.listCandidates(ctx.projectId)
    },
    {
      name: "llm_enrich",
      title: "LLM enrich",
      description:
        "Run optional LLM enrichment through the redaction and audit chain. Disabled by default.",
      inputSchema: z.object({
        target: z
          .enum([
            "endpoint_summary",
            "workflow_naming",
            "entity_description",
            "documentation_polish"
          ])
          .default("endpoint_summary")
      }),
      handler: async (input) =>
        ctx.llmEnrichmentService.enrich({
          projectId: ctx.projectId,
          target: llmTarget(input.target)
        })
    }
  ];
}

export async function invokeTool(
  ctx: SoftwareAnalysisMcpContext,
  name: string,
  input: unknown
): Promise<ReturnType<typeof serializeToolResult>> {
  const started = Date.now();
  const tool = createToolDefinitions(ctx).find((candidate) => candidate.name === name);
  if (tool === undefined) {
    await auditMcpCall(ctx, {
      toolName: name,
      ok: false,
      durationMs: Date.now() - started,
      errorCode: "TOOL_NOT_FOUND",
      input
    });
    return serializeToolResult(
      failure({
        code: "TOOL_NOT_FOUND",
        message: `Tool not found: ${name}`,
        recoverable: true
      })
    );
  }

  try {
    const parsedInput = tool.inputSchema.parse(input);
    const data = await tool.handler(parsedInput);
    await auditMcpCall(ctx, {
      toolName: name,
      ok: true,
      durationMs: Date.now() - started,
      input: parsedInput
    });
    return serializeToolResult(success(data));
  } catch (error) {
    const normalized = normalizeError(error);
    await auditMcpCall(ctx, {
      toolName: name,
      ok: false,
      durationMs: Date.now() - started,
      errorCode: normalized.code,
      input
    });
    return serializeToolResult(failure(normalized));
  }
}

async function auditMcpCall(
  ctx: SoftwareAnalysisMcpContext,
  input: {
    toolName: string;
    ok: boolean;
    durationMs: number;
    errorCode?: string;
    input: unknown;
  }
): Promise<void> {
  await ctx.audit.append({
    id: createId("audit"),
    project_id: ctx.projectId,
    actor: "mcp",
    action: "mcp.tool.called",
    target_type: "mcp_tool",
    target_id: input.toolName,
    metadata: definedRecord({
      ok: input.ok,
      duration_ms: input.durationMs,
      error_code: input.errorCode,
      input_keys: inputKeys(input.input)
    }),
    created_at: new Date().toISOString()
  });
}

function inputKeys(input: unknown): string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [];
  }
  return Object.keys(input).sort();
}

function stringInput(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`Expected string input: ${key}`);
  }
  return value;
}

function definedRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function llmTarget(
  value: unknown
): "endpoint_summary" | "workflow_naming" | "entity_description" | "documentation_polish" {
  if (
    value === "endpoint_summary" ||
    value === "workflow_naming" ||
    value === "entity_description" ||
    value === "documentation_polish"
  ) {
    return value;
  }
  return "endpoint_summary";
}
