// Ports gtm/errors.go: Google API error → user-friendly message, and
// retry-with-backoff for read operations. gtm/errors_test.go defines the
// expected message strings; test/errors.test.ts mirrors those cases.

export interface GoogleErrorItem {
  reason?: string;
  message?: string;
}

interface GtmApiErrorInit {
  status: number;
  message?: string;
  errors?: GoogleErrorItem[];
  body?: string;
}

// Same detail format as gtm/errors.go formatAPIErrorDetail: the top-level
// message, one "reason=" line per error item, then the raw body.
function formatApiErrorDetail(init: GtmApiErrorInit): string {
  let detail = init.message ?? "";
  for (const e of init.errors ?? []) {
    detail += `\n  reason=${e.reason ?? ""}: ${e.message ?? ""}`;
  }
  if (init.body) {
    detail += `\n  body: ${init.body}`;
  }
  return detail;
}

// Same status mapping as gtm/errors.go mapGoogleError.
function mapStatusToMessage(init: GtmApiErrorInit): string {
  const detail = formatApiErrorDetail(init);
  switch (init.status) {
    case 404:
      return `resource not found: ${detail}`;
    case 409:
      return `resource conflict - fingerprint mismatch: ${detail}`;
    case 403:
      return `insufficient permissions: ${detail}`;
    case 429:
      return `rate limit exceeded: ${detail}`;
    case 400:
      return `invalid request: ${detail}`;
    default:
      return `API error ${init.status}: ${detail}`;
  }
}

/** A Google Tag Manager API error with the mapped, user-friendly message. */
export class GtmApiError extends Error {
  readonly status: number;
  readonly apiMessage: string;
  readonly errors: GoogleErrorItem[];
  readonly body: string;

  constructor(init: GtmApiErrorInit) {
    super(mapStatusToMessage(init));
    this.name = "GtmApiError";
    this.status = init.status;
    this.apiMessage = init.message ?? "";
    this.errors = init.errors ?? [];
    this.body = init.body ?? "";
  }

  /** Parse a non-OK GTM API response ({error:{code,message,errors}} body). */
  static async fromResponse(res: Response): Promise<GtmApiError> {
    const body = await res.text();
    let message = "";
    let errors: GoogleErrorItem[] = [];
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; errors?: GoogleErrorItem[] };
      };
      message = parsed.error?.message ?? "";
      if (Array.isArray(parsed.error?.errors)) {
        errors = parsed.error.errors;
      }
    } catch {
      // Non-JSON body; the raw text still lands in the detail via `body`.
    }
    return new GtmApiError({ status: res.status, message, errors, body });
  }
}

export type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Executes fn with exponential backoff on rate-limit errors (403/429),
 * mirroring gtm/errors.go retryWithBackoff: waits 1s/2s/4s... capped at 8s
 * (Go caps at 32s, but Workers wall-clock budgets favor a lower cap; with
 * the default 3 retries the observed waits are identical). The final failed
 * attempt's error is thrown as-is.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  sleep: SleepFn = defaultSleep,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable =
        err instanceof GtmApiError && (err.status === 403 || err.status === 429);
      if (!retryable || attempt >= maxRetries) {
        throw err;
      }
      await sleep(Math.min(2 ** attempt, 8) * 1000);
    }
  }
}
