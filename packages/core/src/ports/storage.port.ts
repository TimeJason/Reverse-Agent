import type { Artifact } from "../domain/artifact.js";
import type { AuditEvent } from "../domain/audit.js";
import type { CaptureSession } from "../domain/capture-session.js";
import type { Evidence, EvidenceSource } from "../domain/evidence.js";
import type { Fact } from "../domain/fact.js";
import type { Finding } from "../domain/finding.js";
import type { PipelineRun } from "../domain/pipeline.js";
import type { RedactionPolicy } from "../domain/policy.js";
import type { Project } from "../domain/project.js";
import type { Workspace } from "../domain/workspace.js";

export interface WorkspaceStore {
  save(workspace: Workspace): Promise<Workspace>;
  get(workspaceId: string): Promise<Workspace | null>;
}

export interface ProjectStore {
  save(project: Project): Promise<Project>;
  get(projectId: string): Promise<Project | null>;
}

export interface CaptureSessionStore {
  save(session: CaptureSession): Promise<CaptureSession>;
  get(sessionId: string): Promise<CaptureSession | null>;
  listByProject(projectId: string): Promise<CaptureSession[]>;
}

export interface EvidenceSourceStore {
  save(source: EvidenceSource): Promise<EvidenceSource>;
  get(sourceId: string): Promise<EvidenceSource | null>;
  listByProject(projectId: string): Promise<EvidenceSource[]>;
}

export interface EvidenceStore {
  save(evidence: Evidence): Promise<Evidence>;
  get(evidenceId: string): Promise<Evidence | null>;
  listByProject(projectId: string): Promise<Evidence[]>;
}

export interface FactStore {
  save(fact: Fact): Promise<Fact>;
  get(factId: string): Promise<Fact | null>;
  listByProject(projectId: string): Promise<Fact[]>;
}

export interface FindingStore {
  save(finding: Finding): Promise<Finding>;
  get(findingId: string): Promise<Finding | null>;
  listByProject(projectId: string): Promise<Finding[]>;
}

export interface PipelineRunStore {
  save(run: PipelineRun): Promise<PipelineRun>;
  get(runId: string): Promise<PipelineRun | null>;
  listByProject(projectId: string): Promise<PipelineRun[]>;
}

export interface ArtifactStore {
  save(artifact: Artifact): Promise<Artifact>;
  get(artifactId: string): Promise<Artifact | null>;
  listByProject(projectId: string): Promise<Artifact[]>;
}

export interface RedactionPolicyStore {
  save(policy: RedactionPolicy): Promise<RedactionPolicy>;
  get(policyId: string): Promise<RedactionPolicy | null>;
  getActiveForProject(projectId: string): Promise<RedactionPolicy | null>;
}

export interface AuditEventStore {
  append(event: AuditEvent): Promise<void>;
  listByProject(projectId: string): Promise<AuditEvent[]>;
}

export interface StoragePort {
  workspaces: WorkspaceStore;
  projects: ProjectStore;
  captureSessions: CaptureSessionStore;
  evidenceSources: EvidenceSourceStore;
  evidence: EvidenceStore;
  facts: FactStore;
  findings: FindingStore;
  pipelineRuns: PipelineRunStore;
  artifacts: ArtifactStore;
  redactionPolicies: RedactionPolicyStore;
  auditEvents: AuditEventStore;
}
