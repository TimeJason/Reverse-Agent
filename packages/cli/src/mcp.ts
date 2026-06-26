#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { serveStdio } from "@software-analysis/mcp";

import { openLocalProject } from "./local-project.js";

export async function runMcpCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program.name("software-analysis-mcp").description("Software Analysis MCP server");
  program
    .command("serve")
    .requiredOption("--project <path>")
    .action(async (options: { project: string }) => {
      const env = await openLocalProject(options.project);
      await serveStdio({
        projectId: env.projectId,
        readFile: (path: string) => env.readProjectFile(path),
        projectService: env.projectService,
        apiAnalysisService: env.apiAnalysisService,
        artifactExportService: env.artifactExportService,
        businessRuleCandidateService: env.businessRuleCandidateService,
        businessUnderstandingService: env.businessUnderstandingService,
        llmEnrichmentService: env.llmEnrichmentService,
        evidenceImportService: env.evidenceImportService,
        evidenceQueryService: env.evidenceQueryService,
        captureSessions: env.storage.captureSessions,
        redactionPolicies: env.storage.redactionPolicies,
        artifacts: env.storage.artifacts,
        providers: env.providers
      });
    });

  await program.parseAsync(argv);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMcpCli();
}
