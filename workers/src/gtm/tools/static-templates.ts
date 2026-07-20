import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getTagTemplates, getTriggerTemplates } from "../static-templates";
import { ok } from "./helpers";

export function registerStaticTemplateTools(server: McpServer) {
  server.registerTool(
    "get_tag_templates",
    {
      description:
        "Get example parameter structures for creating GTM tags. Use this BEFORE creating GA4 or complex tags to see the correct parameter format.",
      inputSchema: {},
    },
    async () =>
      ok({
        templates: getTagTemplates(),
        usage: `These templates show the correct parameter structure for creating GTM tags.

IMPORTANT - Common mistakes to avoid:
1. For GA4 Event tags (gaawe), use measurementIdOverride with an empty measurementId
2. Event parameters use name/value pairs in maps, NOT direct key names
3. For ecommerce, set sendEcommerceData=true and getEcommerceDataFrom=dataLayer

Copy the parameters JSON and modify values as needed when calling create_tag.`,
      }),
  );

  server.registerTool(
    "get_trigger_templates",
    {
      description:
        "Get example structures for creating GTM triggers. Use this to see the correct format for different trigger types.",
      inputSchema: {},
    },
    async () =>
      ok({
        templates: getTriggerTemplates(),
        usage: `These templates show the correct structure for creating GTM triggers.

For customEvent triggers, use customEventFilterJson parameter.
For pageview triggers with conditions, use filterJson parameter.
For click/form triggers with conditions, use autoEventFilterJson parameter.`,
      }),
  );
}
