import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../../types";
import { ok, rfc3339Now } from "./helpers";

export function registerUtilityTools(
  server: McpServer,
  getProps: () => Props | undefined,
) {
  server.registerTool(
    "ping",
    {
      description: "Test connectivity to the GTM MCP server",
      inputSchema: {
        message: z.string().optional().describe("Optional message to echo back"),
      },
    },
    async ({ message }) => {
      const reply = message ? `pong: ${message}` : "pong";
      return ok({ reply, timestamp: rfc3339Now() });
    },
  );

  server.registerTool(
    "auth_status",
    {
      description: "Check authentication status with Google Tag Manager",
      inputSchema: {},
    },
    async () => {
      const props = getProps();
      if (props) {
        return ok({
          authenticated: true,
          message: "You are authenticated and can access GTM data",
        });
      }
      return ok({
        authenticated: false,
        message: "Not authenticated. GTM tools will require authentication.",
      });
    },
  );
}
