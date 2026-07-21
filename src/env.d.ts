// Secret bindings supplied at runtime via `wrangler secret put` (or a local
// .dev.vars). `wrangler types` only emits these into worker-configuration.d.ts
// when a .dev.vars file is present, so declare them here for a CI-safe
// typecheck that doesn't depend on local dev files.
interface GtmSecrets {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COOKIE_ENCRYPTION_KEY: string;
  /**
   * Comma-separated Google account emails allowed to sign in. Set as a
   * Worker variable/secret. Unset = new sign-ins are blocked (fail closed).
   */
  ALLOWED_EMAILS?: string;
  /** Set to "true" to register the delete_container tool (off by default). */
  ENABLE_CONTAINER_DELETION?: string;
}

declare global {
  interface Env extends GtmSecrets {}
  namespace Cloudflare {
    interface Env extends GtmSecrets {}
  }
}

export {};
