import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { validateWorkspacePath } from "../validation";
import { confirmGuard, containerParams, ok, toolError, workspaceParams } from "./helpers";

export function registerVersionTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_versions",
    {
      description:
        "List all container versions. Returns version headers with counts of tags, triggers, variables, and templates.",
      inputSchema: { ...containerParams },
    },
    async ({ accountId, containerId }) => {
      try {
        if (!accountId) throw new Error("accountId is required");
        if (!containerId) throw new Error("containerId is required");
        const versions = await getClient().listVersions(accountId, containerId);
        return ok({ versions });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_version",
    {
      description:
        "Create a new container version from workspace changes. This snapshots the current workspace state but does not publish it.",
      inputSchema: {
        ...workspaceParams,
        name: z.string().optional().describe("Version name (optional)"),
        notes: z.string().optional().describe("Version notes describing changes (optional)"),
      },
    },
    async ({ accountId, containerId, workspaceId, name, notes }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);

        // Pre-flight: refuse when there is nothing to version or when the
        // workspace has unresolved conflicts (mirrors tool_version.go).
        const status = await getClient().getWorkspaceStatus(
          accountId,
          containerId,
          workspaceId,
        );
        if (!status.hasChanges) {
          return ok({
            success: false,
            message: "No changes in workspace to create version from",
          });
        }
        if (status.hasConflicts) {
          return ok({
            success: false,
            message: `Workspace has ${status.conflictCount} conflicts that must be resolved before creating a version`,
          });
        }

        const version = await getClient().createVersion(
          accountId,
          containerId,
          workspaceId,
          { name, notes },
        );
        return ok({
          success: true,
          version,
          message: "Version created successfully. Use publish_version to make it live.",
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "publish_version",
    {
      description:
        "Publish a container version to make it live. Requires confirm: true as a safety guard. WARNING: This pushes changes to your live website.",
      inputSchema: {
        ...containerParams,
        versionId: z.string().describe("The version ID to publish"),
        confirm: z
          .boolean()
          .optional()
          .describe(
            "Must be true to confirm publishing. This is a safety guard - publishing makes changes live.",
          ),
      },
    },
    async ({ accountId, containerId, versionId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Publishing requires confirm: true. WARNING: This will make the version live on your website.",
      );
      if (guard) return guard;
      try {
        if (!accountId || !containerId || !versionId) {
          throw new Error("accountId, containerId, and versionId are required");
        }
        const version = await getClient().publishVersion(accountId, containerId, versionId);
        return ok({
          success: true,
          version,
          message: `Version ${version.containerVersionId} is now LIVE`,
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
