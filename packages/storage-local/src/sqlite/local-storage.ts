import type { StoragePort } from "@software-analysis/core";

import type { SqliteClient } from "./sqlite-client.js";
import { SqliteArtifactRepository } from "./repositories/artifact.repository.js";
import { SqliteAuditEventRepository } from "./repositories/audit-event.repository.js";
import { SqliteCaptureSessionRepository } from "./repositories/capture-session.repository.js";
import { SqliteEvidenceRepository } from "./repositories/evidence.repository.js";
import { SqliteEvidenceSourceRepository } from "./repositories/evidence-source.repository.js";
import { SqliteFactRepository } from "./repositories/fact.repository.js";
import { SqliteFindingRepository } from "./repositories/finding.repository.js";
import { JsonIdRepository } from "./repositories/json-repository.js";
import { SqlitePipelineRunRepository } from "./repositories/pipeline-run.repository.js";
import { SqliteProjectRepository } from "./repositories/project.repository.js";
import { SqliteRedactionPolicyRepository } from "./repositories/redaction-policy.repository.js";
import { WorkspaceSchema } from "@software-analysis/core";
import type { Workspace, WorkspaceStore } from "@software-analysis/core";

class SqliteWorkspaceRepository extends JsonIdRepository<Workspace> implements WorkspaceStore {
  constructor(client: SqliteClient) {
    super(client, "workspaces", WorkspaceSchema);
  }
}

export function createLocalStorage(client: SqliteClient): StoragePort {
  return {
    workspaces: new SqliteWorkspaceRepository(client),
    projects: new SqliteProjectRepository(client),
    captureSessions: new SqliteCaptureSessionRepository(client),
    evidenceSources: new SqliteEvidenceSourceRepository(client),
    evidence: new SqliteEvidenceRepository(client),
    facts: new SqliteFactRepository(client),
    findings: new SqliteFindingRepository(client),
    pipelineRuns: new SqlitePipelineRunRepository(client),
    artifacts: new SqliteArtifactRepository(client),
    redactionPolicies: new SqliteRedactionPolicyRepository(client),
    auditEvents: new SqliteAuditEventRepository(client)
  };
}
