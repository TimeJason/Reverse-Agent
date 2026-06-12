import { isAbsolute, relative, resolve } from "node:path";

export interface WorkspaceLayout {
  projectRoot: string;
  projectConfigPath: string;
  internalRoot: string;
  dbDir: string;
  rawEvidenceDir: string;
  normalizedEvidenceDir: string;
  blobsDir: string;
  artifactsDir: string;
  pipelineRunsDir: string;
  auditDir: string;
  cacheDir: string;
  resolveInsideProject(path: string): string;
}

export function createWorkspaceLayout(projectRoot: string): WorkspaceLayout {
  const root = resolve(projectRoot);
  const internalRoot = resolve(root, ".software-analysis");

  function resolveInsideProject(path: string): string {
    const resolved = resolve(root, path);
    const rel = relative(root, resolved);

    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Path is outside project root: ${path}`);
    }

    return resolved;
  }

  return {
    projectRoot: root,
    projectConfigPath: resolve(root, "project.yaml"),
    internalRoot,
    dbDir: resolve(internalRoot, "db"),
    rawEvidenceDir: resolve(internalRoot, "evidence", "raw"),
    normalizedEvidenceDir: resolve(internalRoot, "evidence", "normalized"),
    blobsDir: resolve(internalRoot, "blobs"),
    artifactsDir: resolve(internalRoot, "artifacts"),
    pipelineRunsDir: resolve(internalRoot, "pipelines", "runs"),
    auditDir: resolve(internalRoot, "audit"),
    cacheDir: resolve(internalRoot, "cache"),
    resolveInsideProject
  };
}
