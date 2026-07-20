// Client-approval cookie + consent dialog for the /authorize front door.
// Follows the pattern of Cloudflare's remote-mcp-google-oauth template: the
// list of client IDs the user has already approved is kept in an
// HMAC-signed cookie so repeat authorizations skip straight to Google.

import type { AuthRequest, ClientInfo } from "@cloudflare/workers-oauth-provider";

const COOKIE_NAME = "mcp-approved-clients";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToHex(sig);
}

async function verifyPayload(
  secret: string,
  payload: string,
  signatureHex: string,
): Promise<boolean> {
  const key = await importHmacKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(signatureHex),
    new TextEncoder().encode(payload),
  );
}

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

/** Read the signed approval cookie; returns the approved client IDs or []. */
async function getApprovedClients(request: Request, secret: string): Promise<string[]> {
  const cookie = getCookie(request, COOKIE_NAME);
  if (!cookie) return [];
  const dot = cookie.indexOf(".");
  if (dot < 0) return [];
  const signature = cookie.slice(0, dot);
  const payload = cookie.slice(dot + 1);
  try {
    if (!(await verifyPayload(secret, payload, signature))) return [];
    const parsed = JSON.parse(atob(payload));
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function clientIdAlreadyApproved(
  request: Request,
  clientId: string,
  secret: string,
): Promise<boolean> {
  return (await getApprovedClients(request, secret)).includes(clientId);
}

async function buildApprovalCookie(
  request: Request,
  clientId: string,
  secret: string,
): Promise<string> {
  const approved = await getApprovedClients(request, secret);
  if (!approved.includes(clientId)) approved.push(clientId);
  const payload = btoa(JSON.stringify(approved));
  const signature = await signPayload(secret, payload);
  return (
    `${COOKIE_NAME}=${signature}.${payload}; HttpOnly; Secure; ` +
    `Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ApprovalDialogOptions {
  client: ClientInfo | null;
  server: {
    name: string;
    description?: string;
  };
  /** Arbitrary state round-tripped through the form (e.g. the AuthRequest). */
  state: Record<string, unknown>;
}

/** Render the consent page shown before redirecting to Google. */
export function renderApprovalDialog(
  request: Request,
  options: ApprovalDialogOptions,
): Response {
  const { client, server, state } = options;
  const encodedState = btoa(JSON.stringify(state));
  const clientName = escapeHtml(client?.clientName || client?.clientId || "Unknown MCP client");
  const serverName = escapeHtml(server.name);
  const description = server.description ? escapeHtml(server.description) : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${clientName} · ${serverName}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; background: #f5f5f4;
    }
    @media (prefers-color-scheme: dark) { body { background: #1c1917; color: #fafaf9; } }
    .card {
      background: #fff; border-radius: 12px; padding: 2rem; max-width: 26rem;
      box-shadow: 0 4px 16px rgba(0,0,0,.08); margin: 1rem;
    }
    @media (prefers-color-scheme: dark) { .card { background: #292524; } }
    h1 { font-size: 1.2rem; margin: 0 0 .5rem; }
    p { line-height: 1.5; }
    .muted { color: #78716c; font-size: .9rem; }
    .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
    button {
      flex: 1; padding: .6rem 1rem; border-radius: 8px; font-size: 1rem;
      cursor: pointer; border: 1px solid #d6d3d1; background: transparent; color: inherit;
    }
    button.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${serverName}</h1>
    ${description ? `<p class="muted">${description}</p>` : ""}
    <p><strong>${clientName}</strong> is requesting access to your Google Tag Manager
    accounts through this MCP server.</p>
    <p class="muted">Approving will send you to Google to sign in and grant
    Tag Manager permissions.</p>
    <form method="post" action="${new URL(request.url).pathname}">
      <input type="hidden" name="state" value="${encodedState}">
      <div class="actions">
        <button type="button" onclick="window.history.back()">Cancel</button>
        <button type="submit" class="primary">Approve</button>
      </div>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export interface ParsedApprovalResult {
  state: { oauthReqInfo?: AuthRequest };
  /** Headers (Set-Cookie) to attach to the redirect response. */
  headers: Record<string, string>;
}

/** Handle the consent form POST: decode state, mint the approval cookie. */
export async function parseRedirectApproval(
  request: Request,
  secret: string,
): Promise<ParsedApprovalResult> {
  const form = await request.formData();
  const encodedState = form.get("state");
  if (typeof encodedState !== "string" || !encodedState) {
    throw new Error("missing state in approval form");
  }
  let state: ParsedApprovalResult["state"];
  try {
    state = JSON.parse(atob(encodedState));
  } catch {
    throw new Error("invalid state in approval form");
  }
  const clientId = state.oauthReqInfo?.clientId;
  if (!clientId) {
    throw new Error("state is missing clientId");
  }
  const cookie = await buildApprovalCookie(request, clientId, secret);
  return { state, headers: { "Set-Cookie": cookie } };
}
