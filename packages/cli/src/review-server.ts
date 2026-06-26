import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { LocalProjectEnvironment } from "./local-project.js";

export interface ReviewServerOptions {
  port: number;
  host: string;
  once?: boolean;
}

export async function startReviewServer(
  env: LocalProjectEnvironment,
  options: ReviewServerOptions
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    void route(env, request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  if (options.once === true) {
    server.close();
  }
  return {
    url: `http://${options.host}:${String(port)}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      })
  };
}

async function route(
  env: LocalProjectEnvironment,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/api/overview") {
      const [project, endpoints, workflows, entities, transitions, rules, artifacts, traffic] =
        await Promise.all([
          env.projectService.getProjectStatus(env.projectId),
          env.apiAnalysisService.listEndpoints(env.projectId),
          env.businessUnderstandingService.listWorkflows(env.projectId),
          env.businessUnderstandingService.listBusinessEntities(env.projectId),
          env.businessUnderstandingService.listStateTransitions(env.projectId),
          env.businessRuleCandidateService.listCandidates(env.projectId),
          env.storage.artifacts.listByProject(env.projectId),
          env.evidenceQueryService.searchTraffic({ project_id: env.projectId, limit: 20 })
        ]);
      json(response, {
        project,
        counts: {
          endpoints: endpoints.length,
          workflows: workflows.length,
          entities: entities.length,
          state_transitions: transitions.length,
          business_rule_candidates: rules.length,
          artifacts: artifacts.length,
          recent_traffic: traffic.items.length
        },
        endpoints,
        workflows,
        entities,
        transitions,
        rules,
        artifacts,
        redaction_status: "redacted"
      });
      return;
    }
    html(response, page());
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function html(response: ServerResponse, value: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(value);
}

function page(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Software Analysis Review</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #24231f; }
    header { padding: 24px 28px; border-bottom: 1px solid #d9d7cf; background: #ffffff; }
    main { display: grid; grid-template-columns: 280px 1fr; gap: 24px; padding: 24px 28px; }
    h1 { margin: 0; font-size: 24px; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    section, aside { background: #ffffff; border: 1px solid #d9d7cf; border-radius: 6px; padding: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .metric { border: 1px solid #e5e3dc; border-radius: 6px; padding: 12px; }
    .metric strong { display: block; font-size: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #eeece5; padding: 8px; text-align: left; vertical-align: top; }
    code { background: #f1f0ea; padding: 2px 4px; border-radius: 4px; }
    .muted { color: #68645b; }
    @media (max-width: 800px) { main { grid-template-columns: 1fr; padding: 16px; } header { padding: 18px 16px; } }
  </style>
</head>
<body>
  <header><h1>Software Analysis Review</h1><div class="muted" id="project">Loading</div></header>
  <main>
    <aside><h2>Overview</h2><div id="metrics" class="grid"></div></aside>
    <section><h2>Endpoints</h2><table><thead><tr><th>Method</th><th>Path</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody id="endpoints"></tbody></table></section>
  </main>
  <script>
    fetch("/api/overview").then(r => r.json()).then(data => {
      document.getElementById("project").textContent = data.project.name + " · " + data.redaction_status;
      document.getElementById("metrics").innerHTML = Object.entries(data.counts).map(([k,v]) => '<div class="metric"><strong>' + v + '</strong><span>' + k + '</span></div>').join("");
      document.getElementById("endpoints").innerHTML = data.endpoints.map(e => '<tr><td><code>' + e.method + '</code></td><td>' + e.path_template + '</td><td>' + e.confidence + '</td><td>' + e.evidence_refs.map(x => '<code>' + x + '</code>').join(" ") + '</td></tr>').join("");
    });
  </script>
</body>
</html>`;
}
