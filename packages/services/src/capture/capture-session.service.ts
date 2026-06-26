import type { AuditSink, CaptureSession, CaptureSessionStore } from "@software-analysis/core";
import { CaptureSessionSchema, createId } from "@software-analysis/core";

export interface CaptureSessionServiceDependencies {
  audit: AuditSink;
  captureSessions: CaptureSessionStore;
}

export interface StartCaptureSessionInput {
  projectId: string;
  mode: "proxy_only" | "browser_assisted" | "manual";
  name?: string;
  proxy?: {
    host?: string;
    port?: number;
  };
  browser?: {
    enabled?: boolean;
    start_url?: string;
    headless?: boolean;
  };
  filters?: {
    include_hosts?: string[];
    exclude_hosts?: string[];
    include_paths?: string[];
    exclude_paths?: string[];
  };
}

export interface StopCaptureSessionResult {
  capture_session_id: string;
  status: "completed" | "cancelled";
}

export class CaptureSessionService {
  constructor(private readonly deps: CaptureSessionServiceDependencies) {}

  async start(input: StartCaptureSessionInput): Promise<CaptureSession> {
    const now = new Date().toISOString();
    const host = input.proxy?.host ?? "127.0.0.1";
    if (host !== "127.0.0.1") {
      throw new Error(
        "Capture sessions bind to 127.0.0.1 unless a future explicit risk override is added."
      );
    }
    const session = CaptureSessionSchema.parse({
      id: createId("cap"),
      project_id: input.projectId,
      source:
        input.mode === "browser_assisted"
          ? "browser"
          : input.mode === "manual"
            ? "manual"
            : "proxy",
      status: "running",
      started_at: now,
      metadata: {
        name: input.name ?? input.mode,
        mode: input.mode,
        proxy: {
          host,
          port: input.proxy?.port ?? 0,
          certificate_instructions:
            "Install and trust the mitmproxy certificate for HTTPS interception when using a real proxy provider."
        },
        browser: input.browser ?? {},
        filters: input.filters ?? {},
        provider_status: "not_attached",
        warning:
          "This session tracks lifecycle state only; live mitmproxy/Playwright providers are not attached in this build."
      }
    });

    await this.deps.captureSessions.save(session);
    await this.audit(input.projectId, "capture.start", session.id, {
      mode: input.mode,
      host,
      provider_status: "not_attached"
    });
    return session;
  }

  async stop(projectId: string, sessionId: string): Promise<StopCaptureSessionResult> {
    const session = await this.requiredSession(projectId, sessionId);
    const nextStatus =
      session.status === "running" || session.status === "created" ? "completed" : session.status;
    const stopped = CaptureSessionSchema.parse({
      ...session,
      status: nextStatus,
      ended_at: session.ended_at ?? new Date().toISOString()
    });
    await this.deps.captureSessions.save(stopped);
    await this.audit(projectId, "capture.stop", sessionId, {
      previous_status: session.status,
      status: stopped.status
    });
    return {
      capture_session_id: sessionId,
      status: stopped.status === "cancelled" ? "cancelled" : "completed"
    };
  }

  async getStatus(projectId: string, sessionId: string): Promise<CaptureSession> {
    const session = await this.requiredSession(projectId, sessionId);
    await this.audit(projectId, "capture.status", sessionId, {
      status: session.status
    });
    return session;
  }

  private async requiredSession(projectId: string, sessionId: string): Promise<CaptureSession> {
    const session = await this.deps.captureSessions.get(sessionId);
    if (session?.project_id !== projectId) {
      throw new Error(`Capture session not found: ${sessionId}`);
    }
    return session;
  }

  private async audit(
    projectId: string,
    action: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.deps.audit.append({
      id: createId("audit"),
      project_id: projectId,
      actor: "service",
      action,
      target_type: "capture_session",
      target_id: targetId,
      metadata,
      created_at: new Date().toISOString()
    });
  }
}
