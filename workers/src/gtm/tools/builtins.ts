import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { validateWorkspacePath } from "../validation";
import { confirmGuard, ok, toolError, workspaceParams } from "./helpers";

export function registerBuiltInVariableTools(
  server: McpServer,
  getClient: () => GtmClient,
) {
  server.registerTool(
    "list_built_in_variables",
    {
      description: "List all enabled built-in variables in a GTM workspace",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const builtInVariables = await getClient().listBuiltInVariables(
          accountId,
          containerId,
          workspaceId,
        );
        return ok({ builtInVariables });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "enable_built_in_variables",
    {
      description: "Enable one or more built-in variable types in a GTM workspace",
      inputSchema: {
        ...workspaceParams,
        types: z
          .array(z.string())
          .describe(
            "Array of built-in variable types to enable (e.g. eventName, clientName, requestPath, pageUrl, event)",
          ),
      },
    },
    async ({ accountId, containerId, workspaceId, types }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!types || types.length === 0) {
          throw new Error("at least one built-in variable type is required");
        }
        const builtInVariables = await getClient().enableBuiltInVariables(
          accountId,
          containerId,
          workspaceId,
          types,
        );
        return ok({
          success: true,
          builtInVariables,
          message: "Built-in variables enabled successfully",
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "disable_built_in_variables",
    {
      description:
        "Disable one or more built-in variable types. Requires confirm: true as a safety guard.",
      inputSchema: {
        ...workspaceParams,
        types: z.array(z.string()).describe("Array of built-in variable types to disable"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm disabling. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, workspaceId, types, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Disabling requires confirm: true. This is a safety guard to prevent accidental changes.",
      );
      if (guard) return guard;
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!types || types.length === 0) {
          throw new Error("at least one built-in variable type is required");
        }
        await getClient().disableBuiltInVariables(
          accountId,
          containerId,
          workspaceId,
          types,
        );
        return ok({ success: true, message: "Built-in variables disabled successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
