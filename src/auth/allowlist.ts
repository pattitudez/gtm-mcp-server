// Google-account allowlist for this server. Comma-separated emails in the
// ALLOWED_EMAILS Worker variable; matching is case-insensitive.
//
// Policy:
// - New sign-ins (/callback): fail closed — with no allowlist configured,
//   nobody can complete a new sign-in.
// - Token refresh: enforced only when an allowlist IS configured, so
//   sessions granted before this feature existed survive a deploy, and
//   removing an email cuts that account off within an hour.

export function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "");
}

export function isEmailAllowed(
  email: string | undefined,
  raw: string | undefined,
): boolean {
  if (!email) return false;
  return parseAllowedEmails(raw).includes(email.trim().toLowerCase());
}
