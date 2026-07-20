import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { parseJsonParam, splitConsentTypes } from "../json-params";
import {
  buildTagPath,
  type Parameter,
  type SetupTagInput,
  type TagInput,
  type TeardownTagInput,
} from "../types";
import { validateTagInput, validateWorkspacePath } from "../validation";
import { confirmGuard, ok, toolError, workspaceParams } from "./helpers";

export function registerTagTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_tags",
    {
      description: "List all tags in a GTM workspace",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const tags = await getClient().listTags(accountId, containerId, workspaceId);
        return ok({ tags });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_tag",
    {
      description: "Get a specific tag by ID",
      inputSchema: {
        ...workspaceParams,
        tagId: z.string().describe("The tag ID to retrieve"),
      },
    },
    async ({ accountId, containerId, workspaceId, tagId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const tag = await getClient().getTag(accountId, containerId, workspaceId, tagId);
        return ok({ tag });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_tag",
    {
      description:
        "Create a new tag in a GTM workspace. Requires at least one firing trigger ID. Always call get_tag_templates before creating GA4 tags",
      inputSchema: {
        ...workspaceParams,
        name: z.string().describe("Tag name"),
        type: z
          .string()
          .describe("Tag type (e.g. gaawe for GA4, html for Custom HTML)"),
        firingTriggerIds: z
          .array(z.string())
          .describe("Array of trigger IDs that fire this tag"),
        blockingTriggerIds: z
          .array(z.string())
          .optional()
          .describe("Array of trigger IDs that block this tag (optional)"),
        parametersJson: z
          .string()
          .optional()
          .describe(
            "Tag parameters as JSON array (optional). Each parameter: {type, key, value} or {type, key, list/map}",
          ),
        setupTagJson: z
          .string()
          .optional()
          .describe(
            "Setup tag sequencing as JSON array (optional). Each element: {tagName: string, stopOnSetupFailure: bool}. The setup tag fires before this tag.",
          ),
        teardownTagJson: z
          .string()
          .optional()
          .describe(
            "Teardown tag sequencing as JSON array (optional). Each element: {tagName: string, stopTeardownOnFailure: bool}. The teardown tag fires after this tag.",
          ),
        consentStatus: z
          .string()
          .optional()
          .describe(
            "Consent status: notSet (default), notNeeded (no consent required), needed (requires consent types to be granted before firing).",
          ),
        consentTypes: z
          .string()
          .optional()
          .describe(
            "Comma-separated consent types when consentStatus is needed (e.g. ad_storage,analytics_storage,ad_user_data,ad_personalization). Ignored when consentStatus is notSet or notNeeded.",
          ),
        notes: z.string().optional().describe("Tag notes (optional)"),
        paused: z.boolean().optional().describe("Whether tag is paused (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        validateTagInput(input.name, input.type, input.firingTriggerIds);

        const tagInput: TagInput = {
          name: input.name,
          type: input.type,
          firingTriggerId: input.firingTriggerIds,
          blockingTriggerId: input.blockingTriggerIds,
          parameter: parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson"),
          notes: input.notes,
          paused: input.paused ?? false,
          setupTag: parseJsonParam<SetupTagInput[]>(input.setupTagJson, "setupTagJson"),
          teardownTag: parseJsonParam<TeardownTagInput[]>(
            input.teardownTagJson,
            "teardownTagJson",
          ),
          consentStatus: input.consentStatus,
          consentTypes: splitConsentTypes(input.consentTypes),
        };

        const tag = await getClient().createTag(
          input.accountId,
          input.containerId,
          input.workspaceId,
          tagInput,
        );
        return ok({ success: true, tag, message: "Tag created successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_tag",
    {
      description:
        "Update an existing tag. Only provided fields are changed — all other fields (parameters, triggers, consent, etc.) are preserved from the existing tag. Automatically handles fingerprint for concurrency control.",
      inputSchema: {
        ...workspaceParams,
        tagId: z.string().describe("The tag ID to update"),
        name: z
          .string()
          .optional()
          .describe("Tag name. If omitted, existing name is preserved."),
        type: z
          .string()
          .optional()
          .describe("Tag type. If omitted, existing type is preserved."),
        firingTriggerIds: z
          .array(z.string())
          .optional()
          .describe(
            "Array of trigger IDs that fire this tag. If omitted, existing triggers are preserved.",
          ),
        blockingTriggerIds: z
          .array(z.string())
          .optional()
          .describe(
            "Array of trigger IDs that block this tag. If omitted, existing blocking triggers are preserved.",
          ),
        parametersJson: z
          .string()
          .optional()
          .describe(
            "Tag parameters as JSON array. If omitted, existing parameters (pixel IDs, measurement IDs, etc.) are preserved.",
          ),
        setupTagJson: z
          .string()
          .optional()
          .describe(
            "Setup tag sequencing as JSON array. Each element: {tagName: string, stopOnSetupFailure: bool}. Pass [] to clear. If omitted, existing setup tags are preserved.",
          ),
        teardownTagJson: z
          .string()
          .optional()
          .describe(
            "Teardown tag sequencing as JSON array. Each element: {tagName: string, stopTeardownOnFailure: bool}. Pass [] to clear. If omitted, existing teardown tags are preserved.",
          ),
        consentStatus: z
          .string()
          .optional()
          .describe(
            "Consent status: notSet (default/clear), notNeeded (no consent required), needed (requires consent types to be granted before firing). If omitted, existing consent settings are preserved.",
          ),
        consentTypes: z
          .string()
          .optional()
          .describe(
            "Comma-separated consent types when consentStatus is needed (e.g. ad_storage,analytics_storage,ad_user_data,ad_personalization). Ignored when consentStatus is notSet or notNeeded.",
          ),
        notes: z
          .string()
          .optional()
          .describe("Tag notes. If omitted, existing notes are preserved."),
        paused: z
          .boolean()
          .optional()
          .describe("Whether tag is paused. If omitted, existing paused state is preserved."),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        if (!input.tagId) throw new Error("tag ID is required");

        const params = parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson");
        const setupTags = parseJsonParam<SetupTagInput[]>(
          input.setupTagJson,
          "setupTagJson",
        );
        const teardownTags = parseJsonParam<TeardownTagInput[]>(
          input.teardownTagJson,
          "teardownTagJson",
        );

        const tagInput: TagInput = {
          name: input.name,
          type: input.type,
          firingTriggerId: input.firingTriggerIds,
          blockingTriggerId: input.blockingTriggerIds,
          parameter: params,
          hasParameter: params !== undefined,
          notes: input.notes,
          paused: input.paused ?? false,
          hasPaused: input.paused !== undefined,
          setupTag: setupTags,
          teardownTag: teardownTags,
          hasSetupTag: setupTags !== undefined,
          hasTeardownTag: teardownTags !== undefined,
          clearSetupTag: setupTags !== undefined && setupTags.length === 0,
          clearTeardownTag: teardownTags !== undefined && teardownTags.length === 0,
          consentStatus: input.consentStatus,
          consentTypes: splitConsentTypes(input.consentTypes),
          hasConsentSettings: !!input.consentStatus,
        };

        const path = buildTagPath(
          input.accountId,
          input.containerId,
          input.workspaceId,
          input.tagId,
        );
        const tag = await getClient().updateTag(path, tagInput);
        return ok({ success: true, tag, message: "Tag updated successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "delete_tag",
    {
      description: "Delete a tag from a workspace. Requires confirm: true as a safety guard.",
      inputSchema: {
        ...workspaceParams,
        tagId: z.string().describe("The tag ID to delete"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm deletion. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, workspaceId, tagId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Deletion requires confirm: true. This is a safety guard to prevent accidental deletions.",
      );
      if (guard) return guard;
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!tagId) throw new Error("tag ID is required");
        await getClient().deleteTag(buildTagPath(accountId, containerId, workspaceId, tagId));
        return ok({ success: true, message: `Tag ${tagId} deleted successfully` });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
