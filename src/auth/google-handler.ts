import { Hono } from "hono";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import llmsTxt from "../../static/llms.txt";
import { SERVER_NAME, SERVER_VERSION, type AuthEnv, type Props } from "../types";
import {
  buildGoogleAuthorizeUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
} from "./upstream";
import {
  clientIdAlreadyApproved,
  parseRedirectApproval,
  renderApprovalDialog,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: AuthEnv }>();

// Secrets set via the Cloudflare dashboard (Worker -> Settings -> Variables
// and Secrets) or `wrangler secret put`. The OAuth flow cannot work without
// them, so the auth routes fail fast with a message naming what's missing.
const REQUIRED_SECRETS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "COOKIE_ENCRYPTION_KEY",
] as const;

function missingSecrets(env: AuthEnv): string[] {
  return REQUIRED_SECRETS.filter((name) => !env[name]);
}

function secretsGuard(c: { env: AuthEnv }): Response | null {
  const missing = missingSecrets(c.env);
  if (missing.length === 0) return null;
  return new Response(
    `Server not configured: missing secret(s) ${missing.join(", ")}.\n` +
      "Add them in the Cloudflare dashboard under this Worker -> Settings -> " +
      "Variables and Secrets (type: Secret), then retry.",
    { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

app.get("/", (c) => {
  const origin = new URL(c.req.url).origin;
  const ready = missingSecrets(c.env).length === 0;
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GTM MCP Server</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.6; }
    code { background: rgba(128,128,128,.15); padding: .15em .4em; border-radius: 4px; }
    table { border-collapse: collapse; }
    td { padding: .25rem .75rem .25rem 0; vertical-align: top; }
    .ok { color: #188038; } .warn { color: #c5221f; }
  </style>
</head>
<body>
  <h1>GTM MCP Server</h1>
  <p>An MCP server for Google Tag Manager, running on Cloudflare Workers.
  Status: <strong class="${ready ? "ok" : "warn"}">${
    ready ? "ready" : "secrets not configured"
  }</strong> (<a href="/health">details</a>)</p>
  <table>
    <tr><td><code>${origin}/mcp</code></td><td>MCP endpoint (streamable HTTP) — add this as a custom connector in claude.ai or Claude Desktop</td></tr>
    <tr><td><code>${origin}/sse</code></td><td>Legacy SSE transport</td></tr>
    <tr><td><code>${origin}/health</code></td><td>Health + configuration check</td></tr>
    <tr><td><code>${origin}/llms.txt</code></td><td>Server capabilities for LLMs</td></tr>
  </table>
  <p>Authentication is Google sign-in via OAuth; MCP clients discover the
  flow automatically. There is nothing else to browse here.</p>
</body>
</html>`);
});

app.get("/health", (c) =>
  c.json({
    status: "healthy",
    service: SERVER_NAME,
    version: SERVER_VERSION,
    // Setup self-check: which required secrets are present (never values).
    config: {
      GOOGLE_CLIENT_ID: !!c.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!c.env.GOOGLE_CLIENT_SECRET,
      COOKIE_ENCRYPTION_KEY: !!c.env.COOKIE_ENCRYPTION_KEY,
    },
  }),
);

app.get("/llms.txt", (c) => c.text(llmsTxt));

app.notFound((c) =>
  c.json(
    {
      error: "not_found",
      hint: "The MCP endpoint is /mcp (streamable HTTP) or /sse (legacy).",
      endpoints: ["/mcp", "/sse", "/health", "/llms.txt"],
    },
    404,
  ),
);

app.get("/authorize", async (c) => {
  const notConfigured = secretsGuard(c);
  if (notConfigured) return notConfigured;
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid authorization request", 400);
  }
  if (
    await clientIdAlreadyApproved(
      c.req.raw,
      oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    )
  ) {
    return redirectToGoogle(c.req.raw, oauthReqInfo, c.env);
  }
  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
  return renderApprovalDialog(c.req.raw, {
    client,
    server: {
      name: "GTM MCP Server",
      description:
        "Manage Google Tag Manager tags, triggers, variables, and versions from AI clients.",
    },
    state: { oauthReqInfo },
  });
});

app.post("/authorize", async (c) => {
  const notConfigured = secretsGuard(c);
  if (notConfigured) return notConfigured;
  const { state, headers } = await parseRedirectApproval(
    c.req.raw,
    c.env.COOKIE_ENCRYPTION_KEY,
  );
  if (!state.oauthReqInfo) {
    return c.text("Invalid approval state", 400);
  }
  return redirectToGoogle(c.req.raw, state.oauthReqInfo, c.env, headers);
});

function redirectToGoogle(
  request: Request,
  oauthReqInfo: AuthRequest,
  env: AuthEnv,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...extraHeaders,
      location: buildGoogleAuthorizeUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: new URL("/callback", request.url).href,
        state: btoa(JSON.stringify(oauthReqInfo)),
      }),
    },
  });
}

app.get("/callback", async (c) => {
  const notConfigured = secretsGuard(c);
  if (notConfigured) return notConfigured;
  const stateParam = c.req.query("state");
  if (!stateParam) {
    return c.text("Missing state", 400);
  }
  let oauthReqInfo: AuthRequest;
  try {
    oauthReqInfo = JSON.parse(atob(stateParam)) as AuthRequest;
  } catch {
    return c.text("Invalid state", 400);
  }
  if (!oauthReqInfo.clientId) {
    return c.text("Invalid state", 400);
  }

  const errorParam = c.req.query("error");
  if (errorParam) {
    return c.text(`Google authorization failed: ${errorParam}`, 400);
  }
  const code = c.req.query("code");
  if (!code) {
    return c.text("Missing authorization code", 400);
  }

  const tokens = await exchangeCodeForTokens({
    clientId: c.env.GOOGLE_CLIENT_ID,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    code,
    redirectUri: new URL("/callback", c.req.url).href,
  });
  if (!tokens.refresh_token) {
    return c.text(
      "Google did not return a refresh token. Remove this app's access at " +
        "https://myaccount.google.com/permissions and try again.",
      400,
    );
  }

  const userInfo = await fetchGoogleUserInfo(tokens.access_token);
  if (!userInfo.email) {
    return c.text("Could not determine Google account email", 400);
  }

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: userInfo.email,
    metadata: { label: userInfo.email },
    scope: oauthReqInfo.scope,
    props: {
      email: userInfo.email,
      name: userInfo.name ?? userInfo.email,
      googleAccessToken: tokens.access_token,
      googleRefreshToken: tokens.refresh_token,
      googleTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    } satisfies Props,
  });

  return Response.redirect(redirectTo);
});

export { app as GoogleHandler };
