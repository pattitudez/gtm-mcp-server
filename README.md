# GTM MCP Server — Cloudflare Workers

A native Cloudflare Workers MCP server for Google Tag Manager — 52 tools,
6 prompts, and 8 resources for managing GTM across all the accounts and
containers your Google identity can access, with no VPS to maintain:

- **`agents` SDK / `McpAgent`** — each MCP session runs in a Durable Object,
  serving both streamable HTTP (`/mcp`) and legacy SSE (`/sse`).
- **`@cloudflare/workers-oauth-provider`** — a complete OAuth 2.1
  authorization server (PKCE, dynamic client registration, RFC 8414/9728
  metadata) with encrypted token storage in Workers KV. Replaces the Go
  server's hand-rolled `auth/` package, and tokens now survive redeploys.
- **Google sign-in upstream** — users authorize via the Google consent
  screen; Google access/refresh tokens live in encrypted grant props.
- Plain-`fetch` GTM API client (no `googleapis` dependency).

## Prerequisites

- A Cloudflare account (Workers Paid recommended — the free tier's 10 ms
  CPU budget is tight for large workspace payloads; Durable Objects work on
  free via the SQLite-backed class this project already uses).
- A Google Cloud OAuth client (Web application). **Reuse the client from the
  VPS deployment if you have one** — its consent screen already carries the
  sensitive Tag Manager scopes, so nothing needs re-verification. You just
  add redirect URIs.
- Node 20+ and npm.

## Google Cloud Console setup

1. APIs & Services → ensure the **Tag Manager API** is enabled.
2. Credentials → your OAuth 2.0 Client ID (Web application) → add
   **Authorized redirect URIs**:
   - `http://localhost:8788/callback` (local dev)
   - `https://<worker-name>.<account>.workers.dev/callback` (after first deploy)
   - `https://your-custom-domain/callback` (if you attach one)
3. Consent screen scopes must include `openid`, `email`, `profile`, and the
   five Tag Manager scopes (`tagmanager.delete.containers`,
   `tagmanager.edit.containers`, `tagmanager.edit.containerversions`,
   `tagmanager.manage.accounts`, `tagmanager.publish`).
4. If the app is in **Testing** mode, refresh tokens expire after 7 days and
   only test users can sign in — publish the app for production use.

## Local development

```bash
cd workers
npm install
cp .dev.vars.example .dev.vars   # fill in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
                                 # and COOKIE_ENCRYPTION_KEY (openssl rand -hex 32)
npm run types                    # generate worker-configuration.d.ts
npm run dev                      # http://localhost:8788
```

Quick checks:

```bash
curl localhost:8788/health
curl localhost:8788/llms.txt
curl localhost:8788/.well-known/oauth-authorization-server
```

End-to-end with the MCP inspector:

```bash
npx @modelcontextprotocol/inspector
```

Connect to `http://localhost:8788/mcp` (streamable HTTP). The inspector will
register a client, walk you through the approval page and Google sign-in,
then list the tools. A good verification pass against a **scratch container**:

1. `ping`, `auth_status`, `list_accounts` → `list_containers` → `list_workspaces`
2. `create_workspace`, then `create_trigger` with `autoEventFilterJson` on a
   `linkClick` trigger — the success message should note the filter remap
3. `create_tag` (call `get_tag_templates` first), `update_tag` with a partial
   update — verify untouched parameters are preserved
4. `delete_tag` **without** `confirm` (should refuse) and with `confirm: true`
5. `get_workspace_status` → `create_version` → `publish_version`

## Deploy

This repo deploys via **Cloudflare Workers Builds** (the Git integration):
every push to `main` runs `npx wrangler deploy`. One-time setup, in order:

**1. KV namespace ID (required — the deploy fails without it).**
The OAuth token store needs a real namespace ID in `wrangler.jsonc`. In the
Cloudflare dashboard go to **Storage & Databases → KV**. An earlier build has
likely already auto-created one named `gtm-mcp-server-oauth-kv` — copy its ID.
(No namespace there? Click *Create a namespace*, name it `OAUTH_KV`, copy the
ID.) Then set it in `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  { "binding": "OAUTH_KV", "id": "<the-32-char-hex-id>" }
]
```

Commit and push — the build goes green. Don't leave `id` out: wrangler's
auto-provisioning (beta) can't see pre-existing namespaces by name and loops
on API error 10014 in CI
([workers-sdk #8721](https://github.com/cloudflare/workers-sdk/issues/8721)).

**2. Worker secrets (required for OAuth to function).**
Dashboard → the `gtm-mcp-server` Worker → **Settings → Variables and
Secrets** → add three entries of type *Secret*:

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from your Google OAuth client |
| `GOOGLE_CLIENT_SECRET` | from your Google OAuth client |
| `COOKIE_ENCRYPTION_KEY` | output of `openssl rand -hex 32` (any long random hex) |
| `ALLOWED_EMAILS` | comma-separated Google emails allowed to sign in (see below) |

**3. Google redirect URI.**
Add `https://gtm-mcp-server.<your-subdomain>.workers.dev/callback` (the exact
host is printed in the green deploy log) to the OAuth client's **Authorized
redirect URIs** in Google Cloud Console.

Alternative to steps handled by CI: run `npx wrangler deploy` once from your
machine (Cloudflare's recommended bootstrap for Git-connected Workers) —
interactive wrangler provisions KV and writes the ID back into
`wrangler.jsonc` for you to commit.

**Branch behavior**: pushes to `staging` run `npx wrangler versions upload`
(a preview, not a production deploy). Preview builds fail with error 10061
until `main` has deployed once, because only `wrangler deploy` can apply the
Durable Object migration. Get `main` green first; staging previews follow.

**Custom domain** (optional): with the zone on Cloudflare DNS, uncomment the
`routes` block in `wrangler.jsonc` (e.g. `cf-mcp.gtmeditor.com`), push,
and add that `/callback` URI to the Google client. You can keep the old VPS
server on `mcp.gtmeditor.com` until you're ready to cut over — the two servers
issue their own tokens, so clients re-authenticate after switching.

## Connect from Claude

- **claude.ai / Claude Desktop**: Settings → Connectors → *Add custom
  connector* → `https://<your-host>/mcp`. Claude discovers the OAuth
  endpoints automatically and opens the Google sign-in.
- **Claude Code**:

  ```bash
  claude mcp add --transport http gtm https://<your-host>/mcp
  ```

Site selection needs no server configuration: sign in with the Google
account that has access to your client containers, then pick the container
per call via `accountId`/`containerId`/`workspaceId` (start with
`list_accounts`). The bundled skill in `skills/gtm-mcp/` works unchanged.

## Access control & fail-safes

- **Email allowlist (`ALLOWED_EMAILS`)** — comma-separated Google account
  emails permitted to sign in; matching is case-insensitive. **Fail-closed:
  with no allowlist configured, every new sign-in is rejected**, so set this
  before (re-)authenticating. Set it as a Worker variable or secret in the
  dashboard (`keep_vars` is enabled so dashboard-set variables survive
  deploys). The list is also enforced on token refresh when configured, so
  removing an email cuts that account off within about an hour.
- **`delete_container` is not registered by default.** It is the only tool
  whose damage isn't a one-click undo (GTM holds deleted containers in trash
  for 30 days, then they're gone). Set `ENABLE_CONTAINER_DELETION=true` on
  the Worker to register it, ideally temporarily.
- **Audit log** — every tool call emits one JSON log line (tool name,
  authenticated user, GTM path/entity IDs, ok/error, duration; never
  parameter payloads or tokens). View them in the dashboard under the
  Worker → **Logs** (observability is enabled in `wrangler.jsonc`).
- **Recovery paths if an AI (or a human) breaks something in GTM**:
  workspace edits aren't live until versioned *and* published; discard the
  workspace to drop unpublished changes; publish a previous version from
  GTM's Versions tab to roll back a bad publish; deleted containers are
  restorable from GTM for 30 days.
- Belt-and-braces: in claude.ai's connector settings you can additionally
  toggle off individual tools (e.g. `publish_version`) client-side.

## Token model

- The provider issues its own MCP access/refresh tokens; Google tokens are
  stored in the encrypted grant props in KV, never given to the client.
- On code exchange, the MCP access-token TTL is clamped to the Google
  token's ~1 h expiry; when the client refreshes, `tokenExchangeCallback`
  refreshes the Google token upstream and persists the new values.
- Long-lived sessions that outlive the Google token refresh in-place inside
  the Durable Object (`getAccessToken`), so streams don't die at the 1 h mark.
- If Google reports `invalid_grant` (access revoked), the client is told to
  re-authenticate.

## Tests

```bash
npm run typecheck
npm test
```

`test/registration.test.ts` asserts the exact 52-tool / 6-prompt /
8-resource surface against the Go server's registry; `mutations.test.ts` and
`errors.test.ts` cover the ported request-shaping and error-mapping logic
(the latter mirrors `gtm/errors_test.go`).

## Differences from the Go server

- **No service-account / API-key (S2S) mode** — Google OAuth sign-in only.
- No per-IP rate limiting middleware; use Cloudflare WAF/rate-limiting rules
  if needed.
- Invalid JSON-string parameters consistently report `invalid <field>: …`
  (the Go server wrapped only some fields).
- Version string is `2.0.0`; `/health` payload shape is unchanged.

**Kept in sync by hand:** `src/gtm/best-practices/docs/*.md` and
`static/llms.txt` are copies of `../gtm/bestpractices/docs/` and
`../llms.txt`. If you edit one side, update the other.
