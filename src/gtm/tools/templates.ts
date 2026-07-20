import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import {
  buildWorkspacePath,
  type ApiCustomTemplate,
  type GalleryReferenceInfo,
  type TemplateInfo,
} from "../types";
import { validateWorkspacePath } from "../validation";
import { confirmGuard, ok, toolError, workspaceParams } from "./helpers";

// Gallery templates are referenced as cvt_{galleryTemplateId}; custom
// templates as cvt_{containerId}_{templateId} (tool_list_templates.go).
function templateType(containerId: string, t: ApiCustomTemplate): string {
  if (t.galleryReference?.galleryTemplateId) {
    return `cvt_${t.galleryReference.galleryTemplateId}`;
  }
  return `cvt_${containerId}_${t.templateId ?? ""}`;
}

function galleryReferenceInfo(
  t: ApiCustomTemplate,
): GalleryReferenceInfo | undefined {
  if (!t.galleryReference?.galleryTemplateId) return undefined;
  const ref: GalleryReferenceInfo = {
    owner: t.galleryReference.owner ?? "",
    repository: t.galleryReference.repository ?? "",
  };
  if (t.galleryReference.version) ref.version = t.galleryReference.version;
  if (t.galleryReference.galleryTemplateId) {
    ref.galleryTemplateId = t.galleryReference.galleryTemplateId;
  }
  return ref;
}

function toTemplateInfo(containerId: string, t: ApiCustomTemplate): TemplateInfo {
  const info: TemplateInfo = {
    templateId: t.templateId ?? "",
    name: t.name ?? "",
    type: templateType(containerId, t),
  };
  const ref = galleryReferenceInfo(t);
  if (ref) info.galleryReference = ref;
  if (t.tagManagerUrl) info.tagManagerUrl = t.tagManagerUrl;
  return info;
}

export function registerTemplateTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_templates",
    {
      description:
        "List all GTM Custom Templates in a workspace. Returns template IDs and their type strings (cvt_{galleryTemplateId} for gallery templates) for use when creating tags.",
      inputSchema: { ...workspaceParams },
    },
    async ({ accountId, containerId, workspaceId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        const raw = await getClient().listTemplates(accountId, containerId, workspaceId);
        return ok({ templates: raw.map((t) => toTemplateInfo(containerId, t)) });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "get_template",
    {
      description:
        "Get a specific custom template by ID. Returns full template details including the template code.",
      inputSchema: {
        ...workspaceParams,
        templateId: z.string().describe("The template ID to retrieve"),
      },
    },
    async ({ accountId, containerId, workspaceId, templateId }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!templateId) throw new Error("templateId is required");
        const path = `${buildWorkspacePath(accountId, containerId, workspaceId)}/templates/${templateId}`;
        const t = await getClient().getTemplate(path);
        const output: Record<string, unknown> = {
          templateId: t.templateId ?? "",
          name: t.name ?? "",
          type: templateType(containerId, t),
          path: t.path ?? "",
          fingerprint: t.fingerprint ?? "",
        };
        if (t.templateData) output.templateData = t.templateData;
        const ref = galleryReferenceInfo(t);
        if (ref) output.galleryReference = ref;
        if (t.tagManagerUrl) output.tagManagerUrl = t.tagManagerUrl;
        return ok(output);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "create_template",
    {
      description:
        "Create a new custom template in a GTM workspace. Requires the full template code in .tpl format. For gallery templates, use import_gallery_template instead.",
      inputSchema: {
        ...workspaceParams,
        name: z.string().describe("Template display name"),
        templateData: z
          .string()
          .describe("The template code in .tpl format (the full template file content)"),
      },
    },
    async ({ accountId, containerId, workspaceId, name, templateData }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!name) throw new Error("name is required");
        if (!templateData) throw new Error("templateData is required");
        const created = await getClient().createTemplate(
          buildWorkspacePath(accountId, containerId, workspaceId),
          { name, templateData },
        );
        const type = `cvt_${containerId}_${created.templateId ?? ""}`;
        const output: Record<string, unknown> = {
          success: true,
          templateId: created.templateId ?? "",
          name: created.name ?? "",
          type,
          path: created.path ?? "",
          message: `Template '${created.name ?? ""}' created successfully. Use type '${type}' when creating tags.`,
        };
        if (created.tagManagerUrl) output.tagManagerUrl = created.tagManagerUrl;
        return ok(output);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_template",
    {
      description:
        "Update an existing custom template. Automatically handles fingerprint for concurrency control. Note: Updating gallery templates may break the link to the gallery. IMPORTANT: To change the visible template name, update the 'displayName' field inside the ___INFO___ section of templateData - the 'name' parameter is only an internal identifier.",
      inputSchema: {
        ...workspaceParams,
        templateId: z.string().describe("The template ID to update"),
        name: z
          .string()
          .optional()
          .describe(
            "Internal template name (optional). Note: This is NOT the visible display name. The visible name comes from the displayName field inside the ___INFO___ section of templateData.",
          ),
        templateData: z
          .string()
          .optional()
          .describe("New template code in .tpl format (optional)"),
      },
    },
    async ({ accountId, containerId, workspaceId, templateId, name, templateData }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!templateId) throw new Error("templateId is required");
        if (!name && !templateData) {
          throw new Error("at least one of name or templateData must be provided");
        }
        const path = `${buildWorkspacePath(accountId, containerId, workspaceId)}/templates/${templateId}`;
        const client = getClient();
        const current = await client.getTemplate(path);
        const updated = await client.updateTemplate(path, {
          name: name || (current.name ?? ""),
          templateData: templateData || (current.templateData ?? ""),
          fingerprint: current.fingerprint ?? "",
        });
        const output: Record<string, unknown> = {
          success: true,
          templateId: updated.templateId ?? "",
          name: updated.name ?? "",
          type: templateType(containerId, updated),
          path: updated.path ?? "",
          fingerprint: updated.fingerprint ?? "",
          message: `Template '${updated.name ?? ""}' updated successfully`,
        };
        if (updated.tagManagerUrl) output.tagManagerUrl = updated.tagManagerUrl;
        return ok(output);
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "delete_template",
    {
      description:
        "Delete a custom template from a workspace. Requires confirm: true as a safety guard. Note: Templates that are in use by tags cannot be deleted.",
      inputSchema: {
        ...workspaceParams,
        templateId: z.string().describe("The template ID to delete"),
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to confirm deletion. This is a safety guard."),
      },
    },
    async ({ accountId, containerId, workspaceId, templateId, confirm }) => {
      const guard = confirmGuard(
        confirm,
        "Deletion requires confirm: true. This is a safety guard to prevent accidental deletions. Templates in use by tags cannot be deleted.",
      );
      if (guard) return guard;
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!templateId) throw new Error("templateId is required");
        const path = `${buildWorkspacePath(accountId, containerId, workspaceId)}/templates/${templateId}`;
        await getClient().deleteTemplate(path);
        return ok({ success: true, message: `Template ${templateId} deleted successfully` });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "import_gallery_template",
    {
      description:
        "Import a GTM Custom Template from the Community Template Gallery into a workspace. Returns the template type string to use when creating tags. Example: import_gallery_template(galleryOwner='iubenda', galleryRepository='gtm-cookie-solution')",
      inputSchema: {
        ...workspaceParams,
        galleryOwner: z
          .string()
          .describe("Owner of the Gallery template (e.g. 'iubenda' or 'GoogleAnalytics')"),
        galleryRepository: z
          .string()
          .describe("Repository of the Gallery template (e.g. 'gtm-cookie-solution')"),
        gallerySha: z
          .string()
          .optional()
          .describe("SHA version of the Gallery template. Defaults to latest if not provided"),
      },
    },
    async ({
      accountId,
      containerId,
      workspaceId,
      galleryOwner,
      galleryRepository,
      gallerySha,
    }) => {
      try {
        validateWorkspacePath(accountId, containerId, workspaceId);
        if (!galleryOwner) throw new Error("galleryOwner is required");
        if (!galleryRepository) throw new Error("galleryRepository is required");
        const imported = await getClient().importGalleryTemplate(
          buildWorkspacePath(accountId, containerId, workspaceId),
          { galleryOwner, galleryRepository, gallerySha },
        );
        const template = toTemplateInfo(containerId, imported);
        return ok({
          success: true,
          template,
          message: `Template '${imported.name ?? ""}' imported successfully. Use type '${template.type}' when creating tags.`,
        });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
