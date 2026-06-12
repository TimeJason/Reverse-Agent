import { z } from "zod";

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
    }
  ];
}

export async function invokeTool(
  ctx: SoftwareAnalysisMcpContext,
  name: string,
  input: unknown
): Promise<ReturnType<typeof serializeToolResult>> {
  const tool = createToolDefinitions(ctx).find((candidate) => candidate.name === name);
  if (tool === undefined) {
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
    return serializeToolResult(success(await tool.handler(parsedInput)));
  } catch (error) {
    return serializeToolResult(failure(normalizeError(error)));
  }
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
