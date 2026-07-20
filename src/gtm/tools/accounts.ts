import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GtmClient } from "../api";
import { ok, toolError } from "./helpers";

export function registerAccountTools(server: McpServer, getClient: () => GtmClient) {
  server.registerTool(
    "list_accounts",
    {
      description: "List all GTM accounts accessible to the authenticated user",
      inputSchema: {},
    },
    async () => {
      try {
        const accounts = await getClient().listAccounts();
        return ok({ accounts });
      } catch (e) {
        return toolError(e);
      }
    },
  );

  server.registerTool(
    "update_account",
    {
      description:
        "Rename a GTM account. Automatically handles fingerprint for concurrency control.",
      inputSchema: {
        accountId: z.string().describe("The GTM account ID"),
        name: z.string().describe("New account display name"),
      },
    },
    async ({ accountId, name }) => {
      try {
        if (!accountId) throw new Error("account ID is required");
        if (!name) throw new Error("name is required");
        const account = await getClient().updateAccount(accountId, name);
        return ok({ success: true, account, message: "Account updated successfully" });
      } catch (e) {
        return toolError(e);
      }
    },
  );
}
