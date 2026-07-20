import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { parseJsonParam } from "../json-params";
import { buildClientPath, type GtmClientInput, type Parameter } from "../types";
import { validateClientInput, validateWorkspacePath } from "../validation";
import { confirmGuard, ok, toolError, workspaceParams } from "./helpers";

export function registerClientTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_clients",
    {
      description: "List all clients in a GTM workspace (server-side containers only)",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const clients = await getClient().listClients(accountId, containerId, workspaceId);
        return ok({ clients });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_client",
    {
      description: "Get a specific client by ID (server-side containers only)",
      inputSchema: {
        ...workspaceParams,
        clientId: z.string().describe("The client ID to retrieve"),
      },
    },
    async ({ accountId, containerId, workspaceId, clientId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const client = await getClient().getClient(
          accountId,
          containerId,
          workspaceId,
          clientId,
        );
        return ok({ client });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_client",
    {
      description: "Create a new client in a GTM workspace (server-side containers only)",
      inputSchema: {
        ...workspaceParams,
        name: z.string().describe("Client name"),
        type: z
          .string()
          .describe("Client type (e.g. __ga4 for GA4, __googtag for Google tag)"),
        priority: z
          .number()
          .int()
          .optional()
          .describe("Client priority (optional, higher runs first)"),
        parametersJson: z
          .string()
          .optional()
          .describe(
            "Client parameters as JSON array (optional). Each parameter: {type, key, value} or {type, key, list/map}",
          ),
        notes: z.string().optional().describe("Client notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        validateClientInput(input.name, input.type);
        const clientInput: GtmClientInput = {
          name: input.name,
          type: input.type,
          priority: input.priority,
          parameter: parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson"),
          notes: input.notes,
        };
        const client = await getClient().createClient(
          input.accountId,
          input.containerId,
          input.workspaceId,
          clientInput,
        );
        return ok({ success: true, client, message: "Client created successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_client",
    {
      description:
        "Update an existing client. Automatically handles fingerprint for concurrency control. Server-side containers only.",
      inputSchema: {
        ...workspaceParams,
        clientId: z.string().describe("The client ID to update"),
        name: z.string().describe("Client name"),
        type: z.string().describe("Client type"),
        priority: z
          .number()
          .int()
          .optional()
          .describe("Client priority (optional, higher runs first)"),
        parametersJson: z
          .string()
          .optional()
          .describe("Client parameters as JSON array (optional)"),
        notes: z.string().optional().describe("Client notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        if (!input.clientId) throw new Error("client ID is required");
        validateClientInput(input.name, input.type);
        const clientInput: GtmClientInput = {
          name: input.name,
          type: input.type,
          priority: input.priority,
          parameter: parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson"),
          notes: input.notes,
        };
        const path = buildClientPath(
          input.accountId,
          input.containerId,
          input.workspaceId,
          input.clientId,
        );
        const client = await getClient().updateClient(path, clientInput);
        return ok({ success: true, client, message: "Client updated successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "delete_client",
    {
      description:
        "Delete a client from a workspace. Requires confirm: true as a safety guard. Server-side containers only.",
      inputSchema: {
        ...workspaceParams,
        clientId: z.string().describe("The client ID to delete"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm deletion. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, workspaceId, clientId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Deletion requires confirm: true. This is a safety guard to prevent accidental deletions.",
      );
      if (guard) return guard;
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!clientId) throw new Error("client ID is required");
        await getClient().deleteClient(
          buildClientPath(accountId, containerId, workspaceId, clientId),
        );
        return ok({ success: true, message: `Client ${clientId} deleted successfully` });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
