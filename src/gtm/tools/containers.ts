import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { buildContainerPath, type CreatedContainer } from "../types";
import { validateContainerPath } from "../validation";
import { confirmGuard, containerParams, ok, toolError } from "./helpers";

const VALID_USAGE_CONTEXTS = new Set([
  "web",
  "android",
  "ios",
  "androidSdk5",
  "iosSdk5",
  "amp",
  "server",
]);

export interface ContainerToolOptions {
  /**
   * delete_container is the one tool whose damage has a 30-day fuse instead
   * of an undo button, so it is not registered unless explicitly enabled
   * (ENABLE_CONTAINER_DELETION="true" on the Worker).
   */
  enableContainerDeletion?: boolean;
}

export function registerContainerTools(
  server: McpServer,
  getClient: () => GtmClient,
  options: ContainerToolOptions = {},
) {
  server.registerTool(
    "list_containers",
    {
      description: "List all containers in a GTM account",
      inputSchema: { accountId: z.string().describe("The GTM account ID") },
    },
    async ({ accountId }) => {
      try {
        if (!accountId) throw new Error("account ID is required");
        const containers = await getClient().listContainers(accountId);
        return ok({ containers });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_container",
    {
      description:
        "Create a new container in a GTM account. UsageContext specifies the container type (web, android, ios, amp, server).",
      inputSchema: {
        accountId: z.string().describe("The GTM account ID"),
        name: z.string().describe("Container display name"),
        usageContext: z
          .array(z.string())
          .describe(
            "Usage context for the container. Valid values: web, android, ios, amp, server",
          ),
        notes: z.string().optional().describe("Container notes (optional)"),
        domainName: z
          .array(z.string())
          .optional()
          .describe("List of domain names associated with the container (optional)"),
        taggingServerUrls: z
          .array(z.string())
          .optional()
          .describe("Server-side container URLs (for server containers only)"),
      },
    },
    async (input) => {
      try {
        if (!input.accountId) throw new Error("account ID is required");
        if (!input.name) throw new Error("name is required");
        if (!input.usageContext || input.usageContext.length === 0) {
          throw new Error(
            "usageContext is required (valid values: web, android, ios, amp, server)",
          );
        }
        for (const uc of input.usageContext) {
          if (!VALID_USAGE_CONTEXTS.has(uc)) {
            throw new Error(
              `invalid usageContext '${uc}' (valid values: web, android, ios, amp, server)`,
            );
          }
        }

        const body: Record<string, unknown> = {
          name: input.name,
          usageContext: input.usageContext,
        };
        if (input.notes) body.notes = input.notes;
        if (input.domainName?.length) body.domainName = input.domainName;
        if (input.taggingServerUrls?.length) {
          body.taggingServerUrls = input.taggingServerUrls;
        }

        const created = await getClient().createContainer(input.accountId, body);
        const container: CreatedContainer = {
          containerId: created.containerId ?? "",
          name: created.name ?? "",
          publicId: created.publicId ?? "",
          usageContext: created.usageContext,
          path: created.path ?? "",
        };
        if (created.tagManagerUrl) container.tagManagerUrl = created.tagManagerUrl;
        return ok({ success: true, container, message: "Container created successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_container",
    {
      description:
        "Rename a GTM container. Preserves all existing settings (usage context, domain, notes). Automatically handles fingerprint for concurrency control.",
      inputSchema: {
        ...containerParams,
        name: z.string().describe("New container display name"),
      },
    },
    async ({ accountId, containerId, name }) => {
      try {
        validateContainerPath(accountId, containerId);
        if (!name) throw new Error("name is required");
        const container = await getClient().updateContainer(accountId, containerId, name);
        return ok({
          success: true,
          container,
          message: "Container updated successfully",
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  if (!options.enableContainerDeletion) {
    return;
  }

  server.registerTool(
    "delete_container",
    {
      description:
        "Delete a GTM container. Requires confirm: true as a safety guard. WARNING: This permanently deletes the container and ALL its contents including tags, triggers, variables, and versions.",
      inputSchema: {
        ...containerParams,
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm deletion. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Deletion requires confirm: true. WARNING: This will permanently delete the container and all its contents (tags, triggers, variables, versions).",
      );
      if (guard) return guard;
      try {
        validateContainerPath(accountId, containerId);
        await getClient().deleteContainer(buildContainerPath(accountId, containerId));
        return ok({
          success: true,
          message: `Container ${containerId} deleted successfully`,
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
