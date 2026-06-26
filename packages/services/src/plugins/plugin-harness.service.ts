import type { AuditSink, PluginManifest } from "@software-analysis/core";
import { PluginManifestSchema, createId } from "@software-analysis/core";

export interface PluginHarnessServiceDependencies {
  audit: AuditSink;
  coreVersion: string;
}

export interface ValidatePluginResult {
  ok: boolean;
  manifest?: PluginManifest;
  errors: string[];
  warnings: string[];
}

export class PluginHarnessService {
  constructor(private readonly deps: PluginHarnessServiceDependencies) {}

  async validate(projectId: string, manifest: unknown): Promise<ValidatePluginResult> {
    const parsed = PluginManifestSchema.safeParse(manifest);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!parsed.success) {
      errors.push(
        ...parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      );
    }
    const value = parsed.success ? parsed.data : undefined;
    if (value !== undefined && !compatible(value.compatible_with.core, this.deps.coreVersion)) {
      errors.push(
        `core version ${this.deps.coreVersion} is not compatible with ${value.compatible_with.core}`
      );
    }
    if (value?.permissions.raw_evidence === true) {
      errors.push("raw evidence permission is not allowed by default");
    }
    if (value?.permissions.network === true) {
      warnings.push("network permission requires explicit review");
    }
    const ok = errors.length === 0;
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: projectId,
      actor: "service",
      action: ok ? "plugin.validate.accepted" : "plugin.validate.rejected",
      target_type: "plugin",
      target_id: value?.name ?? "unknown",
      metadata: {
        ok,
        error_count: errors.length,
        warning_count: warnings.length,
        core_version: this.deps.coreVersion
      },
      created_at: new Date().toISOString()
    });
    return {
      ok,
      ...(value === undefined ? {} : { manifest: value }),
      errors,
      warnings
    };
  }
}

function compatible(range: string, version: string): boolean {
  const major = Number(version.split(".")[0] ?? "0");
  if (range.includes(">=1.0") && range.includes("<2.0")) {
    return major === 1 || version === "0.1.0";
  }
  if (range.startsWith("^")) {
    return range.slice(1).split(".")[0] === String(major);
  }
  return range === version || range === "*";
}
