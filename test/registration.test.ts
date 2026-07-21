// Parity check against the Go server's registered surface: 52 tools with
// identical names, 6 prompts, and 8 resources (2 static + 6 templates).
// Runs the real McpServer over an in-memory transport.

import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GtmClient } from "../src/gtm/api";
import { registerPrompts } from "../src/gtm/prompts";
import { registerResources } from "../src/gtm/resources";
import { registerAllTools } from "../src/gtm/tools";

// The full tool list from the Go server (gtm/tools.go + main.go).
const EXPECTED_TOOLS = [
  "ping",
  "auth_status",
  "list_accounts",
  "update_account",
  "list_containers",
  "list_workspaces",
  "list_tags",
  "get_tag",
  "list_triggers",
  "get_trigger",
  "list_variables",
  "get_variable",
  "list_folders",
  "get_folder_entities",
  "list_templates",
  "get_template",
  "list_versions",
  "create_tag",
  "update_tag",
  "delete_tag",
  "create_trigger",
  "update_trigger",
  "delete_trigger",
  "create_variable",
  "update_variable",
  "delete_variable",
  "create_container",
  "update_container",
  "delete_container",
  "create_workspace",
  "get_workspace_status",
  "create_version",
  "publish_version",
  "import_gallery_template",
  "create_template",
  "update_template",
  "delete_template",
  "list_built_in_variables",
  "enable_built_in_variables",
  "disable_built_in_variables",
  "list_clients",
  "get_client",
  "create_client",
  "update_client",
  "delete_client",
  "list_transformations",
  "get_transformation",
  "create_transformation",
  "update_transformation",
  "delete_transformation",
  "get_tag_templates",
  "get_trigger_templates",
];

const EXPECTED_PROMPTS = [
  "audit_container",
  "generate_tracking_plan",
  "suggest_ga4_setup",
  "find_gallery_template",
  "best_practices_review",
  "plan_safe_edit",
];

async function connectedClient(options?: { enableContainerDeletion?: boolean }) {
  const server = new McpServer({ name: "gtm-mcp-server-test", version: "0.0.0" });
  const getClient = () => new GtmClient(async () => "test-token");
  registerAllTools(server, getClient, () => undefined, options);
  registerResources(server, getClient);
  registerPrompts(server, getClient);

  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("MCP surface parity with the Go server", () => {
  it("registers the Go server tools minus delete_container by default", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    const expected = EXPECTED_TOOLS.filter((t) => t !== "delete_container").sort();
    expect(names).toEqual(expected);
    expect(tools).toHaveLength(51);
  });

  it("registers all 52 tools when container deletion is enabled", async () => {
    const client = await connectedClient({ enableContainerDeletion: true });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(tools).toHaveLength(52);
  });

  it("registers the 6 prompts", async () => {
    const client = await connectedClient();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([...EXPECTED_PROMPTS].sort());
  });

  it("registers 2 static resources and 6 resource templates", async () => {
    const client = await connectedClient();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "gtm://accounts",
      "gtm://best-practices",
    ]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates).toHaveLength(6);
  });

  it("serves the static best-practices resource without auth", async () => {
    const client = await connectedClient();
    const result = await client.readResource({ uri: "gtm://best-practices" });
    const first = result.contents[0] as { mimeType?: string; text: string };
    expect(first.mimeType).toBe("text/markdown");
    expect(first.text).toContain("GTM");
  });

  it("ping works end-to-end", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "ping", arguments: { message: "hi" } });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.reply).toBe("pong: hi");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("emits an audit log line for every tool call", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
      lines.push(String(msg));
    });
    try {
      const client = await connectedClient();
      await client.callTool({ name: "ping", arguments: { message: "audit-me" } });
      await client.callTool({
        name: "delete_tag",
        arguments: { accountId: "1", containerId: "2", workspaceId: "3", tagId: "4" },
      });
    } finally {
      spy.mockRestore();
    }
    const audits = lines
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l))
      .filter((e) => e.audit === "tool_call");
    expect(audits.map((a) => a.tool)).toEqual(["ping", "delete_tag"]);
    const del = audits[1];
    expect(del.args).toMatchObject({
      accountId: "1",
      containerId: "2",
      workspaceId: "3",
      tagId: "4",
    });
    expect(del.user).toBe("unknown");
    expect(del.outcome).toBe("ok");
    expect(typeof del.ms).toBe("number");
  });

  it("delete_tag refuses without confirm (no API call made)", async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: "delete_tag",
      arguments: { accountId: "1", containerId: "2", workspaceId: "3", tagId: "4" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain("confirm: true");
  });

  it("get_tag_templates returns the ported static templates", async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: "get_tag_templates", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.templates).toHaveLength(8);
    expect(parsed.templates[0].type).toBe("gaawc");
    expect(parsed.usage).toContain("measurementIdOverride");
  });

  it("suggest_ga4_setup prompt composes without network", async () => {
    const client = await connectedClient();
    const result = await client.getPrompt({
      name: "suggest_ga4_setup",
      arguments: { goals: "purchase tracking" },
    });
    const first = result.messages[0];
    expect(first.role).toBe("user");
    const text = (first.content as { type: "text"; text: string }).text;
    expect(text).toContain("purchase tracking");
    expect(text).toContain("tagTemplates");
  });
});
