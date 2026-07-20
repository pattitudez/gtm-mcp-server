// Ports gtm/prompts.go: the six prompt workflows. The template text is
// copied verbatim; audit/tracking-plan/best-practices prompts fetch live
// workspace data through the GTM client before composing their message.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import type { GtmClient } from "./api";
import { getBestPractices } from "./best-practices";
import { getTagTemplates, getTriggerTemplates } from "./static-templates";

const workspaceArgs = {
  accountId: z.string().describe("The GTM account ID"),
  containerId: z.string().describe("The GTM container ID"),
  workspaceId: z.string().describe("The GTM workspace ID"),
};

function promptResult(description: string, text: string): GetPromptResult {
  return {
    description,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

async function fetchWorkspaceData(
  client: GtmClient,
  accountId: string,
  containerId: string,
  workspaceId: string,
) {
  const tags = await client.listTags(accountId, containerId, workspaceId).catch((e) => {
    throw new Error(`failed to list tags: ${e instanceof Error ? e.message : e}`);
  });
  const triggers = await client
    .listTriggers(accountId, containerId, workspaceId)
    .catch((e) => {
      throw new Error(`failed to list triggers: ${e instanceof Error ? e.message : e}`);
    });
  const variables = await client
    .listVariables(accountId, containerId, workspaceId)
    .catch((e) => {
      throw new Error(`failed to list variables: ${e instanceof Error ? e.message : e}`);
    });
  return { tags, triggers, variables };
}

export function registerPrompts(server: McpServer, getClient: () => GtmClient) {
  server.registerPrompt(
    "audit_container",
    {
      description:
        "Analyze a GTM workspace for potential issues, duplicates, naming inconsistencies, and best practice violations",
      argsSchema: { ...workspaceArgs },
    },
    async ({ accountId, containerId, workspaceId }) => {
      if (!accountId || !containerId || !workspaceId) {
        throw new Error("accountId, containerId, and workspaceId are required");
      }
      const { tags, triggers, variables } = await fetchWorkspaceData(
        getClient(),
        accountId,
        containerId,
        workspaceId,
      );
      const dataJson = JSON.stringify(
        {
          tags,
          triggers,
          variables,
          summary: {
            totalTags: tags.length,
            totalTriggers: triggers.length,
            totalVariables: variables.length,
          },
        },
        null,
        2,
      );
      const namingRules = getBestPractices("naming-organization");
      const consentRules = getBestPractices("ga4-consent");

      return promptResult(
        "Container audit analysis request",
        `Please audit this GTM workspace for potential issues. Here is the current configuration:

${dataJson}

Please analyze and report on:

1. **Naming Consistency**
   - Are tag, trigger, and variable names following a consistent pattern?
   - Are there any names that are unclear or non-descriptive?

2. **Duplicate Detection**
   - Are there any tags that appear to be duplicates (same type and similar configuration)?
   - Are there triggers that fire on the same conditions?

3. **Orphaned Items**
   - Are there any triggers that are not used by any tags?
   - Are there any variables that don't appear to be referenced?

4. **Best Practices**
   - Are tags properly organized with appropriate triggers?
   - Are there any paused tags that might be forgotten?
   - Are there missing triggers for common use cases?

5. **GA4 Configuration** (if applicable)
   - Is there a GA4 configuration tag?
   - Are event tags properly linked to the configuration?
   - Are ecommerce events configured correctly?

6. **Security Concerns**
   - Are there any custom HTML tags that might pose security risks?
   - Are there any tags loading external scripts?

Use the following rules as the reference standard for sections 1, 3, 4, and 5. If the container consistently follows its own different convention, treat that as acceptable and note the difference:

${namingRules}

---

${consentRules}

Please provide specific recommendations for improvements.`,
      );
    },
  );

  server.registerPrompt(
    "generate_tracking_plan",
    {
      description:
        "Generate a Markdown tracking plan document from existing tags, triggers, and variables in a workspace",
      argsSchema: { ...workspaceArgs },
    },
    async ({ accountId, containerId, workspaceId }) => {
      if (!accountId || !containerId || !workspaceId) {
        throw new Error("accountId, containerId, and workspaceId are required");
      }
      const { tags, triggers, variables } = await fetchWorkspaceData(
        getClient(),
        accountId,
        containerId,
        workspaceId,
      );
      const triggerMap: Record<string, string> = {};
      for (const t of triggers) {
        triggerMap[t.triggerId] = t.name;
      }
      const dataJson = JSON.stringify({ tags, triggers, variables, triggerMap }, null, 2);

      return promptResult(
        "Generate tracking plan documentation",
        `Please generate a comprehensive Markdown tracking plan document from this GTM workspace configuration:

${dataJson}

Generate a document with the following structure:

# Tracking Plan

## Overview
- Summary of the tracking implementation
- Total counts (tags, triggers, variables)

## Events

For each tag, create a section:

### [Event Name]
- **Tag Name:** [name]
- **Tag Type:** [type]
- **Trigger(s):** [list of trigger names]
- **Description:** [inferred purpose]
- **Parameters:** [if applicable]

## Triggers

For each trigger:

### [Trigger Name]
- **Type:** [type]
- **Conditions:** [filter conditions if any]
- **Used by:** [list of tags using this trigger]

## Variables

For each variable:

### [Variable Name]
- **Type:** [type]
- **Purpose:** [inferred purpose]

## Data Layer Requirements

List all dataLayer events and variables that need to be pushed from the website.

## Implementation Notes

Any observations about the implementation, dependencies, or recommendations.

Format the output as clean, professional Markdown.`,
      );
    },
  );

  server.registerPrompt(
    "suggest_ga4_setup",
    {
      description: "Recommend a GA4 tag structure based on tracking goals and requirements",
      argsSchema: {
        goals: z
          .string()
          .describe(
            "Description of tracking goals (e.g., 'ecommerce purchase tracking, form submissions, button clicks')",
          ),
      },
    },
    async ({ goals }) => {
      if (!goals) throw new Error("goals description is required");
      const templatesJson = JSON.stringify(
        { tagTemplates: getTagTemplates(), triggerTemplates: getTriggerTemplates() },
        null,
        2,
      );
      return promptResult(
        "GA4 setup recommendations",
        `I need help setting up GA4 tracking in Google Tag Manager for the following goals:

**Tracking Goals:**
${goals}

Here are the available tag and trigger templates that can be used:

${templatesJson}

Please provide:

1. **Recommended Tags**
   - List each tag needed with:
     - Tag name (following naming convention: "[Category] - [Action]")
     - Tag type
     - Configuration details
     - Which trigger to use

2. **Recommended Triggers**
   - List each trigger needed with:
     - Trigger name
     - Trigger type
     - Filter conditions (if any)

3. **Required Variables**
   - List any Data Layer variables needed
   - List any built-in variables to enable

4. **Data Layer Requirements**
   - Specify what dataLayer pushes the website needs to implement
   - Provide example code snippets for each event

5. **Implementation Order**
   - Step-by-step order to create the tags, triggers, and variables

6. **Testing Checklist**
   - Key scenarios to test
   - Expected GA4 events and parameters

Please be specific about the GTM configuration - use the exact parameter formats shown in the templates.`,
      );
    },
  );

  server.registerPrompt(
    "find_gallery_template",
    {
      description: "Guide to find and import a Community Template Gallery template by name",
      argsSchema: {
        templateName: z
          .string()
          .describe(
            "The name of the template to find (e.g., 'iubenda', 'cookiebot', 'facebook pixel')",
          ),
      },
    },
    async ({ templateName }) => {
      if (!templateName) throw new Error("templateName is required");
      return promptResult(
        "Find and import a Community Template Gallery template",
        `I need to find and import the "${templateName}" template from the GTM Community Template Gallery.

**How to find a Community Template:**

1. **Search the web** for: "${templateName} GTM community template github"
   - Community templates are hosted on GitHub
   - Look for results from github.com

2. **Extract the repository info** from the GitHub URL:
   - URL format: github.com/{owner}/{repository}
   - Example: github.com/iubenda/gtm-cookie-solution
     - galleryOwner: "iubenda"
     - galleryRepository: "gtm-cookie-solution"

3. **Browse the Gallery directly** (optional):
   - Visit: https://tagmanager.google.com/gallery/#/?filter=${templateName}
   - Click on the template to see details

**Common templates for reference:**

| Template | galleryOwner | galleryRepository |
|----------|--------------|-------------------|
| iubenda Cookie Solution | iubenda | gtm-cookie-solution |
| Cookiebot | nicktue-gtm-templates | cookiebot-gtm |
| Facebook Pixel | nicktue-gtm-templates | facebook-pixel |

**Once you have the owner and repository:**

Use the import_gallery_template tool:
- galleryOwner: [owner from GitHub]
- galleryRepository: [repository from GitHub]

The tool will return the template type (cvt_{containerId}_{templateId}) to use when creating tags.

Please search for the "${templateName}" template and provide the galleryOwner and galleryRepository values.`,
      );
    },
  );

  server.registerPrompt(
    "best_practices_review",
    {
      description:
        "Score a GTM workspace against configuration best practices (naming, safe edits, GA4/consent, server-side) with pass/warn/fail per category and concrete fixes",
      argsSchema: { ...workspaceArgs },
    },
    async ({ accountId, containerId, workspaceId }) => {
      if (!accountId || !containerId || !workspaceId) {
        throw new Error("accountId, containerId, and workspaceId are required");
      }
      const { tags, triggers, variables } = await fetchWorkspaceData(
        getClient(),
        accountId,
        containerId,
        workspaceId,
      );
      const dataJson = JSON.stringify({ tags, triggers, variables }, null, 2);
      const rules = ["naming-organization", "ga4-consent", "server-side"]
        .map((topic) => getBestPractices(topic) + "\n\n---\n\n")
        .join("");

      return promptResult(
        "Best practices review request",
        `Please review this GTM workspace against the configuration best practices below.

## Workspace configuration

${dataJson}

## Best practice rules

${rules}

## Instructions

For each category (Naming and Organization, GA4 and Consent, Server-Side if applicable), score the workspace:

- **pass** — rules followed
- **warn** — minor deviations, list them
- **fail** — clear violations, list them

For every warn/fail, give the concrete fix: exact entity name, what to rename/change it to, or which tool call to make. If the container has its own consistent convention that differs from these rules, treat consistency with the existing convention as passing and note the difference instead. Skip the Server-Side category for web containers (no clients present). End with a prioritized fix list.`,
      );
    },
  );

  server.registerPrompt(
    "plan_safe_edit",
    {
      description:
        "Produce a step-by-step plan for a GTM change following the safe-edit workflow: workspace, diff review, version, approved publish",
      argsSchema: {
        accountId: z.string().describe("The GTM account ID"),
        containerId: z.string().describe("The GTM container ID"),
        change_description: z
          .string()
          .describe(
            "Description of the change to make (e.g., 'Add GA4 purchase event tracking')",
          ),
      },
    },
    async ({ accountId, containerId, change_description }) => {
      if (!accountId || !containerId || !change_description) {
        throw new Error("accountId, containerId, and change_description are required");
      }
      const workflow = getBestPractices("safe-edit-workflow");
      const naming = getBestPractices("naming-organization");
      return promptResult(
        "Safe edit plan request",
        `I want to make the following change to GTM container ${containerId} (account ${accountId}):

**Change:** ${change_description}

Follow this workflow strictly:

${workflow}

Apply this naming convention to any new entities:

${naming}

Produce a step-by-step execution plan with the exact tool calls (create_workspace, then entity creation in dependency order with proposed names, then get_workspace_status, create_version with a proposed version name, and finally publish_version pending my approval). Show me the plan before executing anything.`,
      );
    },
  );
}
