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

app.get("/health", (c) =>
  c.json({ status: "healthy", service: SERVER_NAME, version: SERVER_VERSION }),
);

app.get("/llms.txt", (c) => c.text(llmsTxt));

app.get("/authorize", async (c) => {
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
