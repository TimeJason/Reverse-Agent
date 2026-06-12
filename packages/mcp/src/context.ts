import type {
  ArtifactStore,
  CaptureSessionStore,
  EvidenceImportService,
  EvidenceQueryService,
  ImportProvider,
  ProjectService,
  RedactionPolicyStore
} from "./types.js";

export interface SoftwareAnalysisMcpContext {
  projectId: string;
  readFile(path: string): Promise<Uint8Array>;
  projectService: ProjectService;
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
