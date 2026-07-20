import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { parseJsonParam } from "../json-params";
import { isClickLinkFormTrigger } from "../mutations";
import {
  buildTriggerPath,
  type Condition,
  type Parameter,
  type TriggerInput,
} from "../types";
import { validateTriggerInput, validateWorkspacePath } from "../validation";
import { confirmGuard, ok, toolError, workspaceParams } from "./helpers";

const filterJsonDesc =
  "Filter conditions as JSON array for pageview triggers. Condition types: equals, contains, doesNotContain, startsWith, endsWith, matchRegex. Each condition has type and parameter array with arg0 (variable) and arg1 (value). (optional)";
const autoEventFilterJsonDesc =
  "Auto-event filter as JSON array for click/form triggers. Condition types: equals, contains, doesNotContain, startsWith, endsWith, matchRegex. NOTE: for linkClick, click, and formSubmission triggers the GTM API silently drops autoEventFilter — use filterJson instead for these types. (optional)";

export function registerTriggerTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_triggers",
    {
      description: "List all triggers in a GTM workspace",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const triggers = await getClient().listTriggers(accountId, containerId, workspaceId);
        return ok({ triggers });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_trigger",
    {
      description: "Get a specific trigger by ID",
      inputSchema: {
        ...workspaceParams,
        triggerId: z.string().describe("The trigger ID to retrieve"),
      },
    },
    async ({ accountId, containerId, workspaceId, triggerId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!triggerId) throw new Error("triggerId is required");
        const trigger = await getClient().getTrigger(
          accountId,
          containerId,
          workspaceId,
          triggerId,
        );
        return ok({ trigger });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_trigger",
    {
      description:
        "Create a new trigger in a GTM workspace. Common types: pageview, customEvent, linkClick, formSubmission, timer, scrollDepth. Filter condition types: equals, contains, doesNotContain, startsWith, endsWith, matchRegex. The doesNotContain type is automatically transformed to a negated contains condition for the GTM API.",
      inputSchema: {
        ...workspaceParams,
        name: z.string().describe("Trigger name"),
        type: z
          .string()
          .describe(
            "Trigger type (e.g. pageview, customEvent, linkClick, formSubmission, timer)",
          ),
        filterJson: z.string().optional().describe(filterJsonDesc),
        autoEventFilterJson: z.string().optional().describe(autoEventFilterJsonDesc),
        customEventFilterJson: z
          .string()
          .optional()
          .describe(
            "Custom event filter as JSON array for customEvent triggers. Condition types: equals, contains, doesNotContain, startsWith, endsWith, matchRegex. REQUIRED for customEvent type. Must contain exactly one condition matching the event name.",
          ),
        eventNameJson: z
          .string()
          .optional()
          .describe("Event name as JSON object {type, value} for timer triggers (optional)"),
        notes: z.string().optional().describe("Trigger notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        validateTriggerInput(input.name, input.type);

        const autoEventFilter = parseJsonParam<Condition[]>(
          input.autoEventFilterJson,
          "autoEventFilterJson",
        );
        const triggerInput: TriggerInput = {
          name: input.name,
          type: input.type,
          filter: parseJsonParam<Condition[]>(input.filterJson, "filterJson"),
          autoEventFilter,
          customEventFilter: parseJsonParam<Condition[]>(
            input.customEventFilterJson,
            "customEventFilterJson",
          ),
          eventName: parseJsonParam<Parameter>(input.eventNameJson, "eventNameJson"),
          notes: input.notes,
        };

        const { trigger } = await getClient().createTrigger(
          input.accountId,
          input.containerId,
          input.workspaceId,
          triggerInput,
        );

        let message = "Trigger created successfully";
        if (isClickLinkFormTrigger(input.type) && (autoEventFilter?.length ?? 0) > 0) {
          message +=
            ". Note: autoEventFilter was automatically remapped to filter for " +
            input.type +
            " triggers (GTM API requirement).";
        }
        return ok({ success: true, trigger, message });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_trigger",
    {
      description:
        'Update an existing trigger. Filter condition types: equals, contains, doesNotContain, startsWith, endsWith, matchRegex. The doesNotContain type is automatically transformed to a negated contains condition for the GTM API. For trigger groups, use parameterJson with format: [{"key": "triggerIds", "type": "list", "list": [{"type": "triggerReference", "value": "<triggerId>"}, ...]}]',
      inputSchema: {
        ...workspaceParams,
        triggerId: z.string().describe("The trigger ID to update"),
        name: z.string().describe("Trigger name"),
        type: z
          .string()
          .describe("Trigger type (e.g. pageview, customEvent, linkClick, triggerGroup)"),
        filterJson: z.string().optional().describe(filterJsonDesc),
        autoEventFilterJson: z.string().optional().describe(autoEventFilterJsonDesc),
        customEventFilterJson: z
          .string()
          .optional()
          .describe(
            "Custom event filter as JSON array for customEvent triggers. Condition types: equals, contains, doesNotContain, startsWith, endsWith, matchRegex. (optional)",
          ),
        parameterJson: z
          .string()
          .optional()
          .describe(
            "Trigger parameters as JSON array. For triggerGroup type use: [{key: triggerIds, type: list, list: [{type: triggerReference, value: triggerId}, ...]}]",
          ),
        notes: z.string().optional().describe("Trigger notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        if (!input.triggerId) throw new Error("trigger ID is required");
        validateTriggerInput(input.name, input.type);

        let filter = parseJsonParam<Condition[]>(input.filterJson, "filterJson") ?? [];
        let autoEventFilter =
          parseJsonParam<Condition[]>(input.autoEventFilterJson, "autoEventFilterJson") ??
          [];
        const customEventFilter = parseJsonParam<Condition[]>(
          input.customEventFilterJson,
          "customEventFilterJson",
        );
        const params = parseJsonParam<Parameter[]>(input.parameterJson, "parameterJson");

        // The GTM API silently drops autoEventFilter for linkClick, click, and
        // formSubmission triggers. Remap to filter so the conditions persist.
        // See: https://github.com/paolobietolini/gtm-mcp-server/issues/39
        let autoEventFilterWarning = "";
        if (autoEventFilter.length > 0 && isClickLinkFormTrigger(input.type)) {
          filter = [...filter, ...autoEventFilter];
          autoEventFilter = [];
          autoEventFilterWarning =
            "Warning: the GTM API silently ignores autoEventFilter for " +
            input.type +
            " triggers (issue #39). Conditions were automatically remapped to filter.";
        }

        const triggerInput: TriggerInput = {
          name: input.name,
          type: input.type,
          filter: filter.length > 0 ? filter : undefined,
          autoEventFilter: autoEventFilter.length > 0 ? autoEventFilter : undefined,
          customEventFilter,
          parameter: params,
          notes: input.notes,
        };

        const path = buildTriggerPath(
          input.accountId,
          input.containerId,
          input.workspaceId,
          input.triggerId,
        );
        const { trigger } = await getClient().updateTrigger(path, triggerInput);

        let message = "Trigger updated successfully";
        if (autoEventFilterWarning) {
          message += ". " + autoEventFilterWarning;
        }
        return ok({ success: true, trigger, message });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "delete_trigger",
    {
      description:
        "Delete a trigger from a workspace. Requires confirm: true as a safety guard. Note: Triggers that are members of a trigger group cannot be deleted until the trigger group is deleted first.",
      inputSchema: {
        ...workspaceParams,
        triggerId: z.string().describe("The trigger ID to delete"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm deletion. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, workspaceId, triggerId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Deletion requires confirm: true. This is a safety guard to prevent accidental deletions.",
      );
      if (guard) return guard;
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!triggerId) throw new Error("trigger ID is required");
        await getClient().deleteTrigger(
          buildTriggerPath(accountId, containerId, workspaceId, triggerId),
        );
        return ok({ success: true, message: `Trigger ${triggerId} deleted successfully` });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
