import OAuthProvider, {
  GrantType,
  type TokenExchangeCallbackOptions,
  type TokenExchangeCallbackResult,
} from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { env } from "cloudflare:workers";
import { GoogleHandler } from "./auth/google-handler";
import { refreshGoogleToken } from "./auth/upstream";
import {
  GOOGLE_GTM_SCOPES,
  SERVER_NAME,
  SERVER_VERSION,
  type Props,
} from "./types";
import { GtmClient } from "./gtm/api";
import { registerPrompts } from "./gtm/prompts";
import { registerResources } from "./gtm/resources";
import { registerAllTools } from "./gtm/tools";

export class GtmMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // Google access token refreshed mid-session, if any. A long-lived MCP
  // session can outlive the ~1h Google token it was hydrated with; the
  // refreshed token lives here (memory-only — the persisted grant catches
  // up on the next /token exchange via tokenExchangeCallback).
  #tokenCache: { accessToken: string; expiresAt: number } | null = null;

  getAccessToken = async (): Promise<string> => {
    const now = Date.now();
    if (this.#tokenCache && this.#tokenCache.expiresAt - 60_000 > now) {
      return this.#tokenCache.accessToken;
    }
    const props = this.props;
    if (!props) {
      throw new Error("not authenticated - please authenticate with Google first");
    }
    if (props.googleTokenExpiresAt - 60_000 > now) {
      return props.googleAccessToken;
    }
    const refreshed = await refreshGoogleToken({
      clientId: this.env.GOOGLE_CLIENT_ID,
      clientSecret: this.env.GOOGLE_CLIENT_SECRET,
      refreshToken: props.googleRefreshToken,
    });
    this.#tokenCache = {
      accessToken: refreshed.access_token,
      expiresAt: now + refreshed.expires_in * 1000,
    };
    return refreshed.access_token;
  };

  async init() {
    const getClient = () => new GtmClient(this.getAccessToken);
    registerAllTools(this.server, getClient, () => this.props);
    registerResources(this.server, getClient);
    registerPrompts(this.server, getClient);
  }
}

/**
 * Keeps the Google token and the MCP access token in lockstep:
 * - On code exchange, the MCP token TTL is clamped to the Google token's
 *   remaining lifetime, so the client refreshes when Google would expire.
 * - On refresh, the upstream Google token is refreshed too and the new
 *   values are persisted into the encrypted grant props.
 */
async function tokenExchangeCallback(
  options: TokenExchangeCallbackOptions,
): Promise<TokenExchangeCallbackResult | void> {
  const props = options.props as Props;
  if (options.grantType === GrantType.AUTHORIZATION_CODE) {
    const remaining = Math.floor((props.googleTokenExpiresAt - Date.now()) / 1000);
    return { accessTokenTTL: Math.max(60, remaining) };
  }
  if (options.grantType === GrantType.REFRESH_TOKEN) {
    const refreshed = await refreshGoogleToken({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: props.googleRefreshToken,
    });
    return {
      newProps: {
        ...props,
        googleAccessToken: refreshed.access_token,
        googleTokenExpiresAt: Date.now() + refreshed.expires_in * 1000,
        // Google normally keeps the same refresh token; honor rotation if any.
        googleRefreshToken: refreshed.refresh_token ?? props.googleRefreshToken,
      } satisfies Props,
      accessTokenTTL: refreshed.expires_in,
    };
  }
}

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": GtmMCP.serve("/mcp"),
    "/sse": GtmMCP.serveSSE("/sse"),
  },
  defaultHandler: GoogleHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: GOOGLE_GTM_SCOPES,
  tokenExchangeCallback,
});
