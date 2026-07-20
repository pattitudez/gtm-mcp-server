// Ports gtm/resources.go: gtm:// URIs for live GTM data plus the static
// best-practices markdown. The SDK's ResourceTemplate replaces the Go
// uritemplate regex extraction.

import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { GtmClient } from "./api";
import { bestPracticeTopics, getBestPractices } from "./best-practices";

function jsonContents(uri: URL, data: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function markdownContents(uri: URL, text: string): ReadResourceResult {
  return {
    contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
  };
}

function asString(v: string | string[] | undefined, name: string): string {
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new Error(`invalid URI: could not extract ${name}`);
  return s;
}

export function registerResources(server: McpServer, getClient: () => GtmClient) {
  server.registerResource(
    "GTM Accounts",
    "gtm://accounts",
    {
      description:
        "List of all Google Tag Manager accounts accessible to the authenticated user",
      mimeType: "application/json",
    },
    async (uri) => jsonContents(uri, { accounts: await getClient().listAccounts() }),
  );

  server.registerResource(
    "GTM Containers",
    new ResourceTemplate("gtm://accounts/{accountId}/containers", { list: undefined }),
    {
      description: "List of containers in a GTM account",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const accountId = asString(variables.accountId, "accountId");
      return jsonContents(uri, { containers: await getClient().listContainers(accountId) });
    },
  );

  server.registerResource(
    "GTM Workspaces",
    new ResourceTemplate("gtm://accounts/{accountId}/containers/{containerId}/workspaces", {
      list: undefined,
    }),
    {
      description: "List of workspaces in a GTM container",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const accountId = asString(variables.accountId, "accountId");
      const containerId = asString(variables.containerId, "containerId");
      return jsonContents(uri, {
        workspaces: await getClient().listWorkspaces(accountId, containerId),
      });
    },
  );

  server.registerResource(
    "GTM Tags",
    new ResourceTemplate(
      "gtm://accounts/{accountId}/containers/{containerId}/workspaces/{workspaceId}/tags",
      { list: undefined },
    ),
    {
      description: "List of all tags in a GTM workspace",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const accountId = asString(variables.accountId, "accountId");
      const containerId = asString(variables.containerId, "containerId");
      const workspaceId = asString(variables.workspaceId, "workspaceId");
      return jsonContents(uri, {
        tags: await getClient().listTags(accountId, containerId, workspaceId),
      });
    },
  );

  server.registerResource(
    "GTM Triggers",
    new ResourceTemplate(
      "gtm://accounts/{accountId}/containers/{containerId}/workspaces/{workspaceId}/triggers",
      { list: undefined },
    ),
    {
      description: "List of all triggers in a GTM workspace",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const accountId = asString(variables.accountId, "accountId");
      const containerId = asString(variables.containerId, "containerId");
      const workspaceId = asString(variables.workspaceId, "workspaceId");
      return jsonContents(uri, {
        triggers: await getClient().listTriggers(accountId, containerId, workspaceId),
      });
    },
  );

  server.registerResource(
    "GTM Variables",
    new ResourceTemplate(
      "gtm://accounts/{accountId}/containers/{containerId}/workspaces/{workspaceId}/variables",
      { list: undefined },
    ),
    {
      description: "List of all variables in a GTM workspace",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const accountId = asString(variables.accountId, "accountId");
      const containerId = asString(variables.containerId, "containerId");
      const workspaceId = asString(variables.workspaceId, "workspaceId");
      return jsonContents(uri, {
        variables: await getClient().listVariables(accountId, containerId, workspaceId),
      });
    },
  );

  server.registerResource(
    "GTM Best Practices",
    "gtm://best-practices",
    {
      description:
        "Opinionated rules for good GTM configuration: naming, safe edits, GA4/consent, server-side",
      mimeType: "text/markdown",
    },
    async (uri) => markdownContents(uri, getBestPractices("index")),
  );

  server.registerResource(
    "GTM Best Practices Topic",
    new ResourceTemplate("gtm://best-practices/{topic}", {
      list: undefined,
      complete: {
        topic: (value) =>
          bestPracticeTopics().filter((t) => t.startsWith(value ?? "")),
      },
    }),
    {
      description:
        "A single best-practices document: naming-organization, safe-edit-workflow, ga4-consent, or server-side",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const topic = asString(variables.topic, "topic");
      return markdownContents(uri, getBestPractices(topic));
    },
  );
}
