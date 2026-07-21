// Audit trail: one structured log line per tool invocation, visible in
// Workers Logs (observability is enabled in wrangler.jsonc). Logs the tool
// name, the authenticated user, the GTM path/id arguments, and the outcome —
// never parameter payloads or tokens.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Props } from "../../types";

// Scalar identifiers worth recording verbatim. Everything else (e.g. the
// parametersJson blobs) is logged by key name only.
const LOGGED_FIELDS = [
  "accountId",
  "containerId",
  "workspaceId",
  "tagId",
  "triggerId",
  "variableId",
  "folderId",
  "templateId",
  "clientId",
  "transformationId",
  "versionId",
  "name",
  "type",
  "types",
  "confirm",
  "galleryOwner",
  "galleryRepository",
] as const;

type ToolHandler = (args: unknown, extra: unknown) => Promise<unknown> | unknown;

/**
 * Wraps McpServer.registerTool so every tool registered afterwards emits an
 * audit log line. Call once, before any tools are registered.
 */
export function instrumentToolAudit(
  server: McpServer,
  getProps: () => Props | undefined,
): void {
  const original = server.registerTool.bind(server) as (
    name: string,
    config: unknown,
    handler: ToolHandler,
  ) => unknown;

  (server as unknown as { registerTool: unknown }).registerTool = (
    name: string,
    config: unknown,
    handler: ToolHandler,
  ) =>
    original(name, config, async (args: unknown, extra: unknown) => {
      const started = Date.now();
      let outcome = "ok";
      try {
        const result = (await handler(args, extra)) as { isError?: boolean };
        if (result?.isError) outcome = "error";
        return result;
      } catch (err) {
        outcome = "exception";
        throw err;
      } finally {
        const entry: Record<string, unknown> = {
          audit: "tool_call",
          tool: name,
          user: getProps()?.email ?? "unknown",
          outcome,
          ms: Date.now() - started,
        };
        if (args && typeof args === "object") {
          const record = args as Record<string, unknown>;
          const logged: Record<string, unknown> = {};
          for (const field of LOGGED_FIELDS) {
            if (record[field] !== undefined) logged[field] = record[field];
          }
          const otherKeys = Object.keys(record).filter(
            (k) => !(k in logged),
          );
          if (Object.keys(logged).length > 0) entry.args = logged;
          if (otherKeys.length > 0) entry.otherArgKeys = otherKeys;
        }
        console.log(JSON.stringify(entry));
      }
    });
}
