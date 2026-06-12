import type {
  ArtifactStore,
  CaptureSessionStore,
  EvidenceImportService,
  EvidenceQueryService,
  ImportProvider,
  ProjectService,
  ApiAnalysisService,
  ArtifactExportService,
  RedactionPolicyStore
} from "./types.js";

export interface SoftwareAnalysisMcpContext {
  projectId: string;
  readFile(path: string): Promise<Uint8Array>;
  projectService: ProjectService;
  apiAnalysisService: ApiAnalysisService;
  artifactExportService: ArtifactExportService;
  evidenceImportService: EvidenceImportService;
  evidenceQueryService: EvidenceQueryService;
  captureSessions: CaptureSessionStore;
  redactionPolicies?: RedactionPolicyStore;
  artifacts?: ArtifactStore;
  providers: {
    har: ImportProvider;
    logs: ImportProvider;
    mitmproxy: ImportProvider;
  };
}
