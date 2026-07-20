import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { parseJsonParam } from "../json-params";
import { buildVariablePath, type Parameter, type VariableInput } from "../types";
import { validateVariableInput, validateWorkspacePath } from "../validation";
import { confirmGuard, ok, toolError, workspaceParams } from "./helpers";

export function registerVariableTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_variables",
    {
      description: "List all variables in a GTM workspace",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const variables = await getClient().listVariables(
          accountId,
          containerId,
          workspaceId,
        );
        return ok({ variables });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_variable",
    {
      description: "Get a specific variable by ID",
      inputSchema: {
        ...workspaceParams,
        variableId: z.string().describe("The variable ID to retrieve"),
      },
    },
    async ({ accountId, containerId, workspaceId, variableId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!variableId) throw new Error("variableId is required");
        const variable = await getClient().getVariable(
          accountId,
          containerId,
          workspaceId,
          variableId,
        );
        return ok({ variable });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_variable",
    {
      description:
        "Create a new variable in a GTM workspace. Common types: c (Constant), v (Data Layer), k (Cookie), jsm (Custom JavaScript), u (URL). For DLV variables, omit defaultValue entirely or use type template, never type integer with empty value",
      inputSchema: {
        ...workspaceParams,
        name: z.string().describe("Variable name"),
        type: z
          .string()
          .describe(
            "Variable type (e.g. c for Constant, v for Data Layer, k for Cookie, jsm for Custom JavaScript)",
          ),
        parametersJson: z
          .string()
          .optional()
          .describe("Variable parameters as JSON array (required for most types)"),
        notes: z.string().optional().describe("Variable notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        validateVariableInput(input.name, input.type);

        const variableInput: VariableInput = {
          name: input.name,
          type: input.type,
          parameter: parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson"),
          notes: input.notes,
        };
        const variable = await getClient().createVariable(
          input.accountId,
          input.containerId,
          input.workspaceId,
          variableInput,
        );
        return ok({ success: true, variable, message: "Variable created successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_variable",
    {
      description:
        "Update an existing variable. Automatically handles fingerprint for concurrency control.",
      inputSchema: {
        ...workspaceParams,
        variableId: z.string().describe("The variable ID to update"),
        name: z.string().describe("Variable name"),
        type: z
          .string()
          .describe(
            "Variable type (e.g. c for Constant, v for Data Layer, k for Cookie, jsm for Custom JavaScript)",
          ),
        parametersJson: z
          .string()
          .optional()
          .describe("Variable parameters as JSON array (required for most types)"),
        notes: z.string().optional().describe("Variable notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        if (!input.variableId) throw new Error("variableId is required");
        if (!input.name) throw new Error("name is required");
        if (!input.type) throw new Error("type is required");

        const variableInput: VariableInput = {
          name: input.name,
          type: input.type,
          parameter: parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson"),
          notes: input.notes,
        };
        const path = buildVariablePath(
          input.accountId,
          input.containerId,
          input.workspaceId,
          input.variableId,
        );
        const variable = await getClient().updateVariable(path, variableInput);
        return ok({ success: true, variable, message: "Variable updated successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "delete_variable",
    {
      description:
        "Delete a variable from a workspace. Requires confirm: true as a safety guard.",
      inputSchema: {
        ...workspaceParams,
        variableId: z.string().describe("The variable ID to delete"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm deletion. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, workspaceId, variableId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Deletion requires confirm: true. This is a safety guard to prevent accidental deletions.",
      );
      if (guard) return guard;
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!variableId) throw new Error("variable ID is required");
        await getClient().deleteVariable(
          buildVariablePath(accountId, containerId, workspaceId, variableId),
        );
        return ok({
          success: true,
          message: `Variable ${variableId} deleted successfully`,
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
