import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";

import type { SoftwareAnalysisMcpContext } from "./context.js";
import { failure, normalizeError, serializeToolResult, success } from "./envelope.js";
import { createToolDefinitions } from "./tools.js";

export function createSoftwareAnalysisMcpServer(ctx: SoftwareAnalysisMcpContext): McpServer {
  const server = new McpServer({
    name: "software-analysis-mcp",
    version: "0.1.0"
  });

  for (const tool of createToolDefinitions(ctx)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (input) => {
        try {
          const parsed = tool.inputSchema.parse(input);
          return serializeToolResult(success(await tool.handler(parsed)));
        } catch (error) {
          return serializeToolResult(failure(normalizeError(error)));
        }
      }
    );
  }

  return server;
}

export async function serveStdio(ctx: SoftwareAnalysisMcpContext): Promise<McpServer> {
  const server = createSoftwareAnalysisMcpServer(ctx);
  await server.connect(new StdioServerTransport());
  return server;
}
