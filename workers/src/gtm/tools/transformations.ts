import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { parseJsonParam } from "../json-params";
import {
  buildTransformationPath,
  type Parameter,
  type TransformationInput,
} from "../types";
import { validateTransformationInput, validateWorkspacePath } from "../validation";
import { confirmGuard, ok, toolError, workspaceParams } from "./helpers";

export function registerTransformationTools(
  server: McpServer,
  getClient: () => GtmClient,
) {
  server.registerTool(
    "list_transformations",
    {
      description:
        "List all transformations in a GTM workspace (server-side containers only)",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const transformations = await getClient().listTransformations(
          accountId,
          containerId,
          workspaceId,
        );
        return ok({ transformations });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_transformation",
    {
      description: "Get a specific transformation by ID (server-side containers only)",
      inputSchema: {
        ...workspaceParams,
        transformationId: z.string().describe("The transformation ID to retrieve"),
      },
    },
    async ({ accountId, containerId, workspaceId, transformationId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const transformation = await getClient().getTransformation(
          accountId,
          containerId,
          workspaceId,
          transformationId,
        );
        return ok({ transformation });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_transformation",
    {
      description: `Create a new transformation in a GTM workspace (server-side containers only).

Type must be one of: tf_exclude_params, tf_allow_params, tf_augment_event.

Each type uses a different table key and column names in parametersJson:
- tf_allow_params: "allowedParamsTable" with column "allowedParams"
- tf_exclude_params: "excludedParamsTable" with column "excludedParams"
- tf_augment_event: "augmentEventTable" with columns "paramName" and "paramValue"

Common parameters shared by all types:
- matchingConditionsEnabled (boolean) — whether conditions must match
- allTagsExcept (boolean) — if true, apply to all tags except listed ones
- affectedTags (list of maps with tagReference) — specific tags to target
- affectedTagTypes (list of maps with tagType + tagTypeExceptions) — tag types to target
- matchingConditionsTable (list of maps with variableName, variableReference, expressionType, expressionValue)

Example for tf_exclude_params:
[{"key":"excludedParamsTable","type":"list","list":[{"type":"map","map":[{"key":"excludedParams","type":"template","value":"x-fb-ck-fbp"}]}]},{"key":"matchingConditionsEnabled","type":"boolean","value":"false"},{"key":"allTagsExcept","type":"boolean","value":"false"},{"key":"affectedTags","type":"list"},{"key":"affectedTagTypes","type":"list"}]`,
      inputSchema: {
        ...workspaceParams,
        name: z.string().describe("Transformation name"),
        type: z
          .string()
          .describe(
            "Transformation type. Valid values: tf_exclude_params (exclude parameters from tags), tf_allow_params (allow only specified parameters), tf_augment_event (add/modify event parameters)",
          ),
        parametersJson: z
          .string()
          .optional()
          .describe(
            "Transformation parameters as JSON array (optional). Each parameter: {type, key, value} or {type, key, list/map}",
          ),
        notes: z.string().optional().describe("Transformation notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        validateTransformationInput(input.name, input.type);
        const transformationInput: TransformationInput = {
          name: input.name,
          type: input.type,
          parameter: parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson"),
          notes: input.notes,
        };
        const transformation = await getClient().createTransformation(
          input.accountId,
          input.containerId,
          input.workspaceId,
          transformationInput,
        );
        return ok({
          success: true,
          transformation,
          message: "Transformation created successfully",
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_transformation",
    {
      description: `Update an existing transformation. Automatically handles fingerprint for concurrency control. Server-side containers only.

Type must be one of: tf_exclude_params, tf_allow_params, tf_augment_event. Table key and columns per type:
- tf_allow_params: "allowedParamsTable" with column "allowedParams"
- tf_exclude_params: "excludedParamsTable" with column "excludedParams"
- tf_augment_event: "augmentEventTable" with columns "paramName" and "paramValue"`,
      inputSchema: {
        ...workspaceParams,
        transformationId: z.string().describe("The transformation ID to update"),
        name: z.string().describe("Transformation name"),
        type: z
          .string()
          .optional()
          .describe(
            "Transformation type (optional). Valid values: tf_exclude_params, tf_allow_params, tf_augment_event",
          ),
        parametersJson: z
          .string()
          .optional()
          .describe("Transformation parameters as JSON array (optional)"),
        notes: z.string().optional().describe("Transformation notes (optional)"),
      },
    },
    async (input) => {
      try {
        validateWorkspacePath(input.accountId, input.containerId, input.workspaceId);
        if (!input.transformationId) throw new Error("transformation ID is required");
        validateTransformationInput(input.name, input.type ?? "");
        const transformationInput: TransformationInput = {
          name: input.name,
          type: input.type ?? "",
          parameter: parseJsonParam<Parameter[]>(input.parametersJson, "parametersJson"),
          notes: input.notes,
        };
        const path = buildTransformationPath(
          input.accountId,
          input.containerId,
          input.workspaceId,
          input.transformationId,
        );
        const transformation = await getClient().updateTransformation(
          path,
          transformationInput,
        );
        return ok({
          success: true,
          transformation,
          message: "Transformation updated successfully",
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "delete_transformation",
    {
      description:
        "Delete a transformation from a workspace. Requires confirm: true as a safety guard. Server-side containers only.",
      inputSchema: {
        ...workspaceParams,
        transformationId: z.string().describe("The transformation ID to delete"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm deletion. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, workspaceId, transformationId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Deletion requires confirm: true. This is a safety guard to prevent accidental deletions.",
      );
      if (guard) return guard;
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!transformationId) throw new Error("transformation ID is required");
        await getClient().deleteTransformation(
          buildTransformationPath(accountId, containerId, workspaceId, transformationId),
        );
        return ok({
          success: true,
          message: `Transformation ${transformationId} deleted successfully`,
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
