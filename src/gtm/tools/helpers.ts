import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Shared path params carried by every workspace-scoped tool. */
export const workspaceParams = {
  accountId: z.string().describe("The GTM account ID"),
  containerId: z.string().describe("The GTM container ID"),
  workspaceId: z.string().describe("The GTM workspace ID"),
};

export const containerParams = {
  accountId: z.string().describe("The GTM account ID"),
  containerId: z.string().describe("The GTM container ID"),
};

/** Serialize a tool output object the way the Go SDK does: pretty JSON text. */
export function ok(output: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
  };
}

/** Surface an error as a tool result (isError) with its mapped message. */
export function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * Destructive operations require confirm: true. Mirrors the Go handlers,
 * which return success:false (not an error) when unconfirmed.
 */
export function confirmGuard(
  confirm: boolean | undefined,
  message: string,
): CallToolResult | null {
  if (confirm === true) return null;
  return ok({ success: false, message });
}

/** RFC 3339 UTC timestamp with second precision (Go time.RFC3339). */
export function rfc3339Now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
