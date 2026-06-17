import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";

import { Command } from "commander";

import type { LogSearchQuery, TrafficSearchQuery } from "@software-analysis/core";
import {
  createSqliteClient,
  initWorkspace,
  listSqliteTables,
  readProjectConfig,
  runMigrations
} from "@software-analysis/storage-local";

import { openLocalProject } from "./local-project.js";

export interface CliIo {
  stdout(text: string): void;
}

export function createCli(io: CliIo = defaultIo()): Command {
  const program = new Command();
  program.name("software-analysis").description("Software Analysis MCP local CLI");

  program
    .command("init")
    .argument("<path>")
    .option("--json", "print JSON output")
    .action(async (path: string, options: { json?: boolean }) => {
      const result = await initWorkspace(path, {
        name: "Demo Analysis",
        workspaceName: "Local Workspace"
      });
      const client = createSqliteClient(path);
      try {
        runMigrations(client);
      } finally {
        client.close();
      }

      writeOutput(io, options.json, {
        ok: true,
        project: result.config,
        projectRoot: result.projectRoot
      });
    });

  const project = program.command("project");
  project
    .command("status")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; json?: boolean }) => {
      const config = await readProjectConfig(options.project);
      const client = createSqliteClient(options.project);
      try {
        writeOutput(io, options.json, {
          ok: true,
          project: config,
          storage: {
            tables: listSqliteTables(client)
          }
        });
      } finally {
        client.close();
      }
    });

  const importCommand = program.command("import");
  importCommand
    .command("har")
    .argument("<file>")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (file: string, options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.evidenceImportService.import({
          projectId: env.projectId,
          provider: env.providers.har,
          content: new Uint8Array(await readFile(file)),
          uri: file,
          mediaType: "application/json"
        });
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  importCommand
    .command("logs")
    .argument("<file>")
    .requiredOption("--project <path>")
    .option("--format <format>", "jsonl, nginx, or generic", "jsonl")
    .option("--service <service>")
    .option("--json", "print JSON output")
    .action(
      async (
        file: string,
        options: { project: string; format: string; service?: string; json?: boolean }
      ) => {
        const env = await openLocalProject(options.project);
        try {
          const result = await env.evidenceImportService.import({
            projectId: env.projectId,
            provider: env.providers.logs,
            content: new Uint8Array(await readFile(file)),
            uri: file,
            mediaType: "text/plain",
            options: { format: options.format, service: options.service }
          });
          writeOutput(io, options.json, { ok: true, result });
        } finally {
          env.close();
        }
      }
    );

  importCommand
    .command("mitmproxy")
    .argument("<file>")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (file: string, options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.evidenceImportService.import({
          projectId: env.projectId,
          provider: env.providers.mitmproxy,
          content: new Uint8Array(await readFile(file)),
          uri: file,
          mediaType: "application/octet-stream"
        });
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  importCommand
    .command("browser-events")
    .argument("<file>")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (file: string, options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.evidenceImportService.import({
          projectId: env.projectId,
          provider: env.providers.browser,
          content: new Uint8Array(await readFile(file)),
          uri: file,
          mediaType: "application/x-ndjson"
        });
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  const traffic = program.command("traffic");
  traffic
    .command("search")
    .requiredOption("--project <path>")
    .option("--host <host>")
    .option("--method <method>")
    .option("--path-contains <text>")
    .option("--status-code <code>")
    .option("--json", "print JSON output")
    .action(
      async (options: {
        project: string;
        host?: string;
        method?: string;
        pathContains?: string;
        statusCode?: string;
        json?: boolean;
      }) => {
        const env = await openLocalProject(options.project);
        try {
          const query = definedRecord({
            project_id: env.projectId,
            host: options.host,
            method: options.method,
            path_contains: options.pathContains,
            status_code: options.statusCode === undefined ? undefined : Number(options.statusCode)
          }) as TrafficSearchQuery;
          const result = await env.evidenceQueryService.searchTraffic(query);
          writeOutput(io, options.json, { ok: true, result });
        } finally {
          env.close();
        }
      }
    );

  traffic
    .command("get")
    .argument("<evidence-id>")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (evidenceId: string, options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.evidenceQueryService.getRequest(env.projectId, evidenceId);
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  const logs = program.command("logs");
  logs
    .command("search")
    .requiredOption("--project <path>")
    .option("--level <level>")
    .option("--service <service>")
    .option("--trace-id <traceId>")
    .option("--request-id <requestId>")
    .option("--message-contains <text>")
    .option("--json", "print JSON output")
    .action(
      async (options: {
        project: string;
        level?: string;
        service?: string;
        traceId?: string;
        requestId?: string;
        messageContains?: string;
        json?: boolean;
      }) => {
        const env = await openLocalProject(options.project);
        try {
          const query = definedRecord({
            project_id: env.projectId,
            level: options.level,
            service: options.service,
            trace_id: options.traceId,
            request_id: options.requestId,
            message_contains: options.messageContains
          }) as LogSearchQuery;
          const result = await env.evidenceQueryService.searchLogs(query);
          writeOutput(io, options.json, { ok: true, result });
        } finally {
          env.close();
        }
      }
    );

  const api = program.command("api");
  api
    .command("analyze")
    .requiredOption("--project <path>")
    .option("--capture-session <id>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; captureSession?: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.apiAnalysisService.analyzeApiSurface(
          definedRecord({
            projectId: env.projectId,
            captureSessionId: options.captureSession
          }) as { projectId: string; captureSessionId?: string }
        );
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  api
    .command("list")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.apiAnalysisService.listEndpoints(env.projectId);
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  api
    .command("get")
    .argument("<endpoint-id>")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (endpointId: string, options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.apiAnalysisService.getEndpoint(env.projectId, endpointId);
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  const analyze = program.command("analyze");
  analyze
    .command("workflows")
    .requiredOption("--project <path>")
    .option("--capture-session <id>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; captureSession?: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        await env.businessUnderstandingService.correlateBrowserEvents(
          definedRecord({
            projectId: env.projectId,
            captureSessionId: options.captureSession
          }) as { projectId: string; captureSessionId?: string }
        );
        const result = await env.businessUnderstandingService.inferWorkflows(
          definedRecord({
            projectId: env.projectId,
            captureSessionId: options.captureSession
          }) as { projectId: string; captureSessionId?: string }
        );
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  analyze
    .command("entities")
    .requiredOption("--project <path>")
    .option("--capture-session <id>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; captureSession?: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.businessUnderstandingService.inferBusinessEntities(
          definedRecord({
            projectId: env.projectId,
            captureSessionId: options.captureSession
          }) as { projectId: string; captureSessionId?: string }
        );
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  analyze
    .command("state-transitions")
    .requiredOption("--project <path>")
    .option("--capture-session <id>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; captureSession?: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.businessUnderstandingService.inferStateTransitions(
          definedRecord({
            projectId: env.projectId,
            captureSessionId: options.captureSession
          }) as { projectId: string; captureSessionId?: string }
        );
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  const workflows = program.command("workflows");
  workflows
    .command("list")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.businessUnderstandingService.listWorkflows(env.projectId);
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  const entities = program.command("entities");
  entities
    .command("list")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.businessUnderstandingService.listBusinessEntities(env.projectId);
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  const stateTransitions = program.command("state-transitions");
  stateTransitions
    .command("list")
    .requiredOption("--project <path>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.businessUnderstandingService.listStateTransitions(env.projectId);
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  const exportCommand = program.command("export");
  exportCommand
    .command("openapi")
    .requiredOption("--project <path>")
    .option("--format <format>", "json or yaml", "json")
    .option("--pipeline-run <id>")
    .option("--json", "print JSON output")
    .action(
      async (options: {
        project: string;
        format: string;
        pipelineRun?: string;
        json?: boolean;
      }) => {
        const env = await openLocalProject(options.project);
        try {
          const format = options.format === "yaml" ? "yaml" : "json";
          const result = await env.artifactExportService.exportOpenApi(
            definedRecord({
              projectId: env.projectId,
              pipelineRunId: options.pipelineRun,
              format
            }) as { projectId: string; pipelineRunId?: string; format: "json" | "yaml" }
          );
          writeOutput(io, options.json, { ok: true, result });
        } finally {
          env.close();
        }
      }
    );

  exportCommand
    .command("markdown")
    .requiredOption("--project <path>")
    .option("--pipeline-run <id>")
    .option("--json", "print JSON output")
    .action(async (options: { project: string; pipelineRun?: string; json?: boolean }) => {
      const env = await openLocalProject(options.project);
      try {
        const result = await env.artifactExportService.exportMarkdown(
          definedRecord({
            projectId: env.projectId,
            pipelineRunId: options.pipelineRun
          }) as { projectId: string; pipelineRunId?: string }
        );
        writeOutput(io, options.json, { ok: true, result });
      } finally {
        env.close();
      }
    });

  program
    .command("doctor")
    .option("--json", "print JSON output")
    .action((options: { json?: boolean }) => {
      writeOutput(io, options.json, {
        ok: true,
        checks: {
          node: {
            ok: true,
            version: process.version
          }
        }
      });
    });

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createCli().parseAsync(argv);
}

function writeOutput(io: CliIo, json: boolean | undefined, value: unknown): void {
  io.stdout(json === true ? JSON.stringify(value) : JSON.stringify(value, null, 2));
}

function defaultIo(): CliIo {
  return {
    stdout(text: string): void {
      process.stdout.write(`${text}\n`);
    }
  };
}

function definedRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
