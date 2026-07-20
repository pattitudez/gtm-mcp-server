import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { buildContainerPath, type CreatedWorkspace } from "../types";
import { validateContainerPath, validateWorkspacePath } from "../validation";
import { containerParams, ok, toolError, workspaceParams } from "./helpers";

export function registerWorkspaceTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_workspaces",
    {
      description: "List all workspaces in a GTM container",
      inputSchema: { ...containerParams },
    },
    async ({ accountId, containerId }) => {
      try {
        validateContainerPath(accountId, containerId);
        const workspaces = await getClient().listWorkspaces(accountId, containerId);
        return ok({ workspaces });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_workspace",
    {
      description:
        "Create a new workspace in a GTM container. Workspaces are used to make changes that can later be versioned and published.",
      inputSchema: {
        ...containerParams,
        name: z.string().describe("Workspace display name"),
        description: z.string().optional().describe("Workspace description (optional)"),
      },
    },
    async ({ accountId, containerId, name, description }) => {
      try {
        validateContainerPath(accountId, containerId);
        if (!name) throw new Error("name is required");
        const created = await getClient().createWorkspace(
          buildContainerPath(accountId, containerId),
          { name, description },
        );
        const workspace: CreatedWorkspace = {
          workspaceId: created.workspaceId ?? "",
          name: created.name ?? "",
          path: created.path ?? "",
        };
        if (created.description) workspace.description = created.description;
        if (created.tagManagerUrl) workspace.tagManagerUrl = created.tagManagerUrl;
        return ok({ success: true, workspace, message: "Workspace created successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_workspace_status",
    {
      description:
        "Check if a workspace has pending changes or merge conflicts before versioning.",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const status = await getClient().getWorkspaceStatus(
          accountId,
          containerId,
          workspaceId,
        );
        return ok({ status });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
