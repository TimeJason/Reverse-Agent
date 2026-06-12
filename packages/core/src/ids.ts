import { randomUUID } from "node:crypto";

import { z } from "zod";

const prefixPattern = /^[a-z][a-z0-9-]*$/;
const valuePattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type EntityId = `${string}_${string}`;

export function createId(prefix: string, value: string = randomUUID()): EntityId {
  if (!prefixPattern.test(prefix)) {
    throw new Error(`Invalid id prefix: ${prefix}`);
  }

  if (!valuePattern.test(value)) {
    throw new Error(`Invalid id value: ${value}`);
  }

  return `${prefix}_${value}`;
}

export function idSchema(prefix: string): z.ZodString {
  return z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]*$`));
}

export const WorkspaceIdSchema = idSchema("ws");
export const ProjectIdSchema = idSchema("proj");
export const CaptureSessionIdSchema = idSchema("cap");
export const EvidenceSourceIdSchema = idSchema("src");
export const EvidenceIdSchema = idSchema("ev");
export const FactIdSchema = idSchema("fact");
export const FindingIdSchema = idSchema("find");
export const PipelineRunIdSchema = idSchema("run");
export const ArtifactIdSchema = idSchema("art");
export const RedactionPolicyIdSchema = idSchema("policy");
export const AuditEventIdSchema = idSchema("audit");
