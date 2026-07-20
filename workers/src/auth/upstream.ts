import { OAuthError } from "@cloudflare/workers-oauth-provider";
import { GOOGLE_GTM_SCOPES } from "../types";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface GoogleUserInfo {
  email: string;
  name?: string;
}

/**
 * Build the Google consent-screen URL. access_type=offline + prompt=consent
 * mirror the Go server's AccessTypeOffline + ApprovalForce so Google always
 * issues a refresh token.
 */
export function buildGoogleAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_GTM_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export async function exchangeCodeForTokens(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`failed to exchange code: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Exchange a Google refresh token for a fresh access token.
 *
 * Throws OAuthError so a failure inside the /token endpoint's
 * tokenExchangeCallback surfaces as a proper OAuth error response
 * (invalid_grant → the MCP client re-runs the authorization flow).
 */
export async function refreshGoogleToken(opts: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 || res.status === 401) {
      throw new OAuthError("invalid_grant", {
        description:
          "Google refresh token is no longer valid - please re-authenticate",
        statusCode: 400,
      });
    }
    if (res.status === 429) {
      throw new OAuthError("temporarily_unavailable", {
        description: "Google token endpoint rate limited",
        statusCode: 429,
        headers: { "Retry-After": res.headers.get("retry-after") ?? "60" },
      });
    }
    throw new Error(`failed to refresh Google token: ${res.status} ${body}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`failed to fetch user info: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleUserInfo;
}
