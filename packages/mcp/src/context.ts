import type {
  ArtifactStore,
  AuditSink,
  CaptureSessionStore,
  EvidenceImportService,
  EvidenceQueryService,
  ImportProvider,
  ProjectService,
  ApiAnalysisService,
  ArtifactExportService,
  BusinessRuleCandidateService,
  BusinessUnderstandingService,
  CaptureSessionService,
  LlmEnrichmentService,
  RedactionPolicyStore
} from "./types.js";

export interface SoftwareAnalysisMcpContext {
  projectId: string;
  readFile(path: string): Promise<Uint8Array>;
  audit: AuditSink;
  projectService: ProjectService;
  apiAnalysisService: ApiAnalysisService;
  artifactExportService: ArtifactExportService;
  businessRuleCandidateService: BusinessRuleCandidateService;
  businessUnderstandingService: BusinessUnderstandingService;
  captureSessionService: CaptureSessionService;
  llmEnrichmentService: LlmEnrichmentService;
  evidenceImportService: EvidenceImportService;
  evidenceQueryService: EvidenceQueryService;
  captureSessions: CaptureSessionStore;
  redactionPolicies?: RedactionPolicyStore;
  artifacts?: ArtifactStore;
  providers: {
    har: ImportProvider;
    browser: ImportProvider;
    logs: ImportProvider;
    mitmproxy: ImportProvider;
  };
}
