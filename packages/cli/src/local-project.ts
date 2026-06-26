import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import type { Project, Workspace } from "@software-analysis/core";
import {
  ApiAnalysisService,
  ArtifactDiffService,
  ArtifactExportService,
  AuditService,
  BenchmarkManifestService,
  BrowserEventImportProvider,
  BusinessRuleCandidateService,
  BusinessUnderstandingService,
  CaptureSessionService,
  DiagnosticsService,
  DisabledLlmProvider,
  EvidenceImportService,
  EvidenceQueryService,
  HarImportProvider,
  LlmEnrichmentService,
  LogImportProvider,
  MitmproxyDumpImportProvider,
  PluginHarnessService,
  ProjectService
} from "@software-analysis/services";
import {
  FileBlobStore,
  createLocalStorage,
  createSqliteClient,
  createWorkspaceLayout,
  readProjectConfig,
  runMigrations,
  type SqliteClient
} from "@software-analysis/storage-local";

export interface LocalProjectEnvironment {
  client: SqliteClient;
  projectId: string;
  storage: ReturnType<typeof createLocalStorage>;
  projectService: ProjectService;
  apiAnalysisService: ApiAnalysisService;
  artifactDiffService: ArtifactDiffService;
  artifactExportService: ArtifactExportService;
  benchmarkManifestService: BenchmarkManifestService;
  businessRuleCandidateService: BusinessRuleCandidateService;
  businessUnderstandingService: BusinessUnderstandingService;
  captureSessionService: CaptureSessionService;
  diagnosticsService: DiagnosticsService;
  llmEnrichmentService: LlmEnrichmentService;
  pluginHarnessService: PluginHarnessService;
  evidenceImportService: EvidenceImportService;
  evidenceQueryService: EvidenceQueryService;
  providers: {
    har: HarImportProvider;
    browser: BrowserEventImportProvider;
    logs: LogImportProvider;
    mitmproxy: MitmproxyDumpImportProvider;
  };
  readFile(path: string): Promise<Uint8Array>;
  readProjectFile(path: string): Promise<Uint8Array>;
  close(): void;
}

export async function openLocalProject(projectRoot: string): Promise<LocalProjectEnvironment> {
  const config = await readProjectConfig(projectRoot);
  const client = createSqliteClient(projectRoot);
  runMigrations(client);

  const storage = createLocalStorage(client);
  const workspace: Workspace = {
    id: config.workspace_id,
    name: config.workspace_name,
    created_at: config.created_at,
    updated_at: config.updated_at
  };
  const project: Project = {
    id: config.id,
    workspace_id: config.workspace_id,
    name: config.name,
    root_path: projectRoot,
    project_schema_version: config.project_schema_version,
    evidence_schema_version: config.evidence_schema_version,
    artifact_schema_version: config.artifact_schema_version,
    worker_protocol_version: config.worker_protocol_version,
    created_at: config.created_at,
    updated_at: config.updated_at
  };

  await storage.workspaces.save(workspace);
  await storage.projects.save(project);

  const audit = new AuditService(storage.auditEvents);
  const projectService = new ProjectService({ audit, projects: storage.projects });
  const layout = createWorkspaceLayout(projectRoot);
  const evidenceImportService = new EvidenceImportService({
    audit,
    blobStore: new FileBlobStore(projectRoot),
    captureSessions: storage.captureSessions,
    evidence: storage.evidence,
    evidenceSources: storage.evidenceSources
  });

  return {
    client,
    projectId: project.id,
    storage,
    projectService,
    apiAnalysisService: new ApiAnalysisService({
      audit,
      evidence: storage.evidence,
      facts: storage.facts,
      findings: storage.findings,
      pipelineRuns: storage.pipelineRuns
    }),
    artifactExportService: new ArtifactExportService({
      artifacts: storage.artifacts,
      facts: storage.facts,
      pipelineRuns: storage.pipelineRuns,
      writeArtifact: async (path: string, content: string) => {
        await mkdir(layout.artifactsDir, { recursive: true });
        const resolved = resolve(layout.artifactsDir, path);
        await writeFile(resolved, content, "utf8");
        return path;
      }
    }),
    artifactDiffService: new ArtifactDiffService({
      audit,
      artifacts: storage.artifacts,
      projectRoot,
      writeArtifact: async (path: string, content: string) => {
        await mkdir(layout.artifactsDir, { recursive: true });
        const resolved = resolve(layout.artifactsDir, path);
        await writeFile(resolved, content, "utf8");
        return path;
      }
    }),
    benchmarkManifestService: new BenchmarkManifestService(),
    businessRuleCandidateService: new BusinessRuleCandidateService({
      audit,
      evidence: storage.evidence,
      facts: storage.facts,
      findings: storage.findings,
      pipelineRuns: storage.pipelineRuns
    }),
    businessUnderstandingService: new BusinessUnderstandingService({
      audit,
      evidence: storage.evidence,
      facts: storage.facts,
      findings: storage.findings,
      pipelineRuns: storage.pipelineRuns
    }),
    captureSessionService: new CaptureSessionService({
      audit,
      captureSessions: storage.captureSessions
    }),
    diagnosticsService: new DiagnosticsService({
      audit,
      artifacts: storage.artifacts,
      captureSessions: storage.captureSessions,
      evidence: storage.evidence,
      facts: storage.facts,
      pipelineRuns: storage.pipelineRuns
    }),
    llmEnrichmentService: new LlmEnrichmentService({
      audit,
      facts: storage.facts,
      findings: storage.findings,
      provider: new DisabledLlmProvider()
    }),
    pluginHarnessService: new PluginHarnessService({
      audit,
      coreVersion: "0.1.0"
    }),
    evidenceImportService,
    evidenceQueryService: new EvidenceQueryService(storage.evidence),
    providers: {
      har: new HarImportProvider(),
      browser: new BrowserEventImportProvider(),
      logs: new LogImportProvider(),
      mitmproxy: new MitmproxyDumpImportProvider()
    },
    readFile: async (path: string) => new Uint8Array(await readFile(path)),
    readProjectFile: async (path: string) => {
      const resolved = resolveAllowedProjectPath(projectRoot, path);
      return new Uint8Array(await readFile(resolved));
    },
    close(): void {
      client.close();
    }
  };
}

export function resolveAllowedProjectPath(projectRoot: string, path: string): string {
  const root = resolve(projectRoot);
  const resolved = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const rel = relative(root, resolved);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`MCP file imports are limited to the project root: ${path}`);
  }

  return resolved;
}
