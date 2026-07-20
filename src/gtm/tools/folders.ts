import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { validateWorkspacePath } from "../validation";
import { ok, toolError, workspaceParams } from "./helpers";

export function registerFolderTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_folders",
    {
      description:
        "List all folders (trigger groups) in a GTM workspace. Folders help organize tags, triggers, and variables.",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const folders = await getClient().listFolders(accountId, containerId, workspaceId);
        return ok({ folders });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_folder_entities",
    {
      description: "Get the tags, triggers, and variables inside a specific folder.",
      inputSchema: {
        ...workspaceParams,
        folderId: z.string().describe("The folder ID"),
      },
    },
    async ({ accountId, containerId, workspaceId, folderId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const entities = await getClient().getFolderEntities(
          accountId,
          containerId,
          workspaceId,
          folderId,
        );
        return ok({ entities });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
