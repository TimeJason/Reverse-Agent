import { describe, expect, test } from "vitest";

import type { AuditEvent, AuditSink } from "@software-analysis/core";

import {
  AuditService,
  createDefaultRedactionPolicy,
  redactRecord,
  stableHashWithProjectSalt
} from "../src/index.js";

class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

describe("policy and audit services", () => {
  test("creates a default redaction policy with a project salt", () => {
    const policy = createDefaultRedactionPolicy("proj_demo");

    expect(policy.rules).toEqual(
      expect.arrayContaining(["credentials", "cookies", "supported_pii_candidates"])
    );
    expect(policy.salt).toMatch(/^[a-f0-9]{64}$/);
  });

  test("redacts common secrets and keeps deterministic salted hashes", () => {
    const policy = createDefaultRedactionPolicy("proj_demo", "salt");
    const redacted = redactRecord(
      {
        Authorization: "Bearer token-value",
        Cookie: "session=abc",
        password: "correct horse",
        nested: { api_token: "abc123", ok: "visible" }
      },
      policy
    );

    expect(redacted.value).toEqual({
      Authorization: "[REDACTED:credential]",
      Cookie: "[REDACTED:cookie]",
      password: "[REDACTED:credential]",
      nested: { api_token: "[REDACTED:credential]", ok: "visible" }
    });
    expect(redacted.redactions).toEqual(
      expect.arrayContaining(["Authorization", "Cookie", "password", "nested.api_token"])
    );
    expect(stableHashWithProjectSalt("secret", policy.salt)).toBe(
      stableHashWithProjectSalt("secret", policy.salt)
    );
  });

  test("refuses audit metadata that appears to contain raw secrets", async () => {
    const sink = new MemoryAuditSink();
    const audit = new AuditService(sink);

    await expect(
      audit.append({
        id: "audit_demo",
        project_id: "proj_demo",
        actor: "cli",
        action: "secret.leak",
        target_type: "test",
        target_id: "target",
        metadata: { Authorization: "Bearer raw-token" },
        created_at: "2026-06-09T00:00:00.000Z"
      })
    ).rejects.toThrow(/raw secret/i);

    expect(sink.events).toHaveLength(0);
  });
});
