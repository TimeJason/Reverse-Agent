import { createHash, randomBytes } from "node:crypto";

export interface DefaultRedactionPolicy {
  project_id: string;
  mode: "default";
  salt: string;
  rules: string[];
}

export interface RedactionResult<T> {
  value: T;
  redactions: string[];
}

const credentialKeyPattern = /authorization|password|passwd|token|secret|api[-_]?key/i;
const cookieKeyPattern = /^cookie$|^set-cookie$/i;

export function createDefaultRedactionPolicy(
  projectId: string,
  salt = randomBytes(32).toString("hex")
): DefaultRedactionPolicy {
  return {
    project_id: projectId,
    mode: "default",
    salt,
    rules: ["credentials", "cookies", "supported_pii_candidates"]
  };
}

export function stableHashWithProjectSalt(value: string, salt: string): string {
  return createHash("sha256").update(salt).update(":").update(value).digest("hex");
}

export function redactRecord<T>(value: T, policy: DefaultRedactionPolicy): RedactionResult<T> {
  const redactions: string[] = [];
  const activeRules = new Set(policy.rules);
  const redacted = redactUnknown(value, activeRules, [], redactions);
  return {
    value: redacted as T,
    redactions
  };
}

function redactUnknown(
  value: unknown,
  activeRules: ReadonlySet<string>,
  path: string[],
  redactions: string[]
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactUnknown(item, activeRules, [...path, String(index)], redactions)
    );
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const nextPath = [...path, key];
        if (shouldRedactKey(key, activeRules)) {
          redactions.push(nextPath.join("."));
          return [key, redactionPlaceholder(key)];
        }
        return [key, redactUnknown(child, activeRules, nextPath, redactions)];
      })
    );
  }

  return value;
}

function shouldRedactKey(key: string, activeRules: ReadonlySet<string>): boolean {
  return (
    (activeRules.has("credentials") && credentialKeyPattern.test(key)) ||
    (activeRules.has("cookies") && cookieKeyPattern.test(key))
  );
}

function redactionPlaceholder(key: string): string {
  return cookieKeyPattern.test(key) ? "[REDACTED:cookie]" : "[REDACTED:credential]";
}
