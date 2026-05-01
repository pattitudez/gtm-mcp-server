"""
GTM Agent — programmatic access via Service Account (S2S mode)

This example shows how to build an AI agent that manages Google Tag Manager
using the GTM MCP Server with a shared API key, no OAuth or browser login needed.

Requirements:
    pip install anthropic requests

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    python gtm_agent.py

Self-hosted server setup (see README Self-Hosting section):
    SERVICE_ACCOUNT_API_KEY=your-secret \
    GOOGLE_SERVICE_ACCOUNT_KEY_JSON="$(cat key.json)" \
    go run main.go
"""

import os
import json
import requests
import anthropic

# ── Configuration ────────────────────────────────────────────────────────────

MCP_URL = "http://localhost:8080/mcp"

# The API key configured via SERVICE_ACCOUNT_API_KEY on the server.
# All GTM operations run under the server's Google Service Account —
# the caller doesn't need personal GTM access.
MCP_API_KEY = os.environ.get("MCP_API_KEY", "your-api-key-here")

MCP_HEADERS = {
    "Authorization": f"Bearer {MCP_API_KEY}",
    "Content-Type": "application/json",
    "Accept": "application/json",
}

# ── MCP helpers ──────────────────────────────────────────────────────────────

_session_id = None  # MCP session, reused across calls


def mcp_call(method: str, params: dict | None = None) -> dict:
    """Send a JSON-RPC request to the MCP server and return the result."""
    global _session_id

    headers = MCP_HEADERS.copy()
    if _session_id:
        headers["Mcp-Session-Id"] = _session_id

    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or {},
    }

    response = requests.post(MCP_URL, headers=headers, json=payload, timeout=30)
    response.raise_for_status()

    # Capture the session ID from the server on first response
    if not _session_id and "Mcp-Session-Id" in response.headers:
        _session_id = response.headers["Mcp-Session-Id"]

    data = response.json()
    if "error" in data:
        raise RuntimeError(f"MCP error: {data['error']}")

    return data.get("result", {})


def initialize_session() -> None:
    """Perform the MCP handshake (required before any other call)."""
    mcp_call("initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "gtm-agent", "version": "1.0"},
    })
    # Notify the server that initialization is complete
    mcp_call("notifications/initialized")


def list_tools() -> list[dict]:
    """Fetch all available GTM tools from the server."""
    result = mcp_call("tools/list")
    return result.get("tools", [])


def call_tool(name: str, arguments: dict) -> str:
    """Execute a GTM tool and return the result as a string."""
    result = mcp_call("tools/call", {"name": name, "arguments": arguments})
    # MCP returns content as a list of typed blocks; extract text
    content = result.get("content", [])
    return "\n".join(
        block.get("text", json.dumps(block))
        for block in content
        if isinstance(block, dict)
    )


# ── Agent loop ───────────────────────────────────────────────────────────────

def run_agent(user_prompt: str) -> str:
    """
    Run an agentic loop: Claude decides which GTM tools to call,
    we execute them via the MCP server, and feed results back until done.
    """
    client = anthropic.Anthropic()

    # Convert MCP tool definitions to Anthropic's format.
    # MCP uses `inputSchema`; Anthropic expects `input_schema`.
    tools = [
        {
            "name": t["name"],
            "description": t.get("description", ""),
            "input_schema": t.get("inputSchema", {"type": "object"}),
        }
        for t in list_tools()
    ]

    messages = [{"role": "user", "content": user_prompt}]

    print(f"\nAgent › {user_prompt}\n")

    while True:
        response = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=4096,
            tools=tools,
            messages=messages,
        )

        # Collect any text Claude produced this turn
        for block in response.content:
            if hasattr(block, "text"):
                print(f"Claude › {block.text}")

        # If Claude is done (no more tool calls), return the final answer
        if response.stop_reason == "end_turn":
            return next(
                (b.text for b in response.content if hasattr(b, "text")),
                "(no text response)",
            )

        # Execute each tool Claude requested
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            print(f"  → calling {block.name}({json.dumps(block.input)})")
            result_text = call_tool(block.name, block.input)
            print(f"  ← {result_text[:200]}{'…' if len(result_text) > 200 else ''}")

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result_text,
            })

        # Feed Claude's tool calls and their results back into the conversation
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    initialize_session()

    # Example: ask the agent to explore your GTM account
    run_agent(
        "List all my GTM accounts and containers. "
        "For each container, show the number of tags in the default workspace."
    )
