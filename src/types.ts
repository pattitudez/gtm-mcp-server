import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export const SERVER_NAME = "gtm-mcp-server";
export const SERVER_VERSION = "2.0.0";

// Mirrors auth/google.go GoogleScopes, plus identity scopes so the callback
// can resolve a stable userId (email) for the grant record.
export const GOOGLE_GTM_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/tagmanager.delete.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containers",
  "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
  "https://www.googleapis.com/auth/tagmanager.manage.accounts",
  "https://www.googleapis.com/auth/tagmanager.publish",
];

/**
 * Per-grant application state. Encrypted at rest inside the OAuth provider's
 * KV storage and surfaced to the Durable Object as `this.props`.
 */
export type Props = {
  email: string;
  name: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  /** Epoch milliseconds at which googleAccessToken expires. */
  googleTokenExpiresAt: number;
  [key: string]: unknown;
};

/** Env as seen by the OAuth default handler (provider injects OAUTH_PROVIDER). */
export type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };
