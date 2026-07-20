// Ported from gtm/errors_test.go — the authoritative spec for error-message
// mapping and retry behavior.

import { describe, expect, it } from "vitest";
import { GtmApiError, retryWithBackoff } from "../src/gtm/errors";

const noSleep = async () => {};

describe("GtmApiError message mapping", () => {
  it("maps 404 to resource not found", () => {
    const err = new GtmApiError({ status: 404, message: "Resource not found" });
    expect(err.message).toBe("resource not found: Resource not found");
  });

  it("maps 409 to fingerprint conflict", () => {
    const err = new GtmApiError({ status: 409, message: "Fingerprint mismatch" });
    expect(err.message).toBe(
      "resource conflict - fingerprint mismatch: Fingerprint mismatch",
    );
  });

  it("maps 403 to insufficient permissions", () => {
    const err = new GtmApiError({ status: 403, message: "Permission denied" });
    expect(err.message).toBe("insufficient permissions: Permission denied");
  });

  it("maps 429 to rate limit exceeded", () => {
    const err = new GtmApiError({ status: 429, message: "Rate limit exceeded" });
    expect(err.message).toBe("rate limit exceeded: Rate limit exceeded");
  });

  it("maps 400 to invalid request", () => {
    const err = new GtmApiError({ status: 400, message: "Invalid request parameters" });
    expect(err.message).toBe("invalid request: Invalid request parameters");
  });

  it("labels unknown status codes as API error", () => {
    const err = new GtmApiError({ status: 500, message: "Internal server error" });
    expect(err.message).toBe("API error 500: Internal server error");
  });

  it("includes the original message for every mapped status", () => {
    const cases: Array<[number, string]> = [
      [404, "Tag not found"],
      [409, "Version conflict"],
      [403, "Access denied"],
      [429, "Too many requests"],
      [400, "Bad input"],
    ];
    for (const [status, message] of cases) {
      const err = new GtmApiError({ status, message });
      expect(err.message).toContain(message);
    }
  });

  it("appends reason lines and body like formatAPIErrorDetail", () => {
    const err = new GtmApiError({
      status: 404,
      message: "Not found",
      errors: [{ reason: "notFound", message: "Entity missing" }],
      body: '{"error":{}}',
    });
    expect(err.message).toBe(
      'resource not found: Not found\n  reason=notFound: Entity missing\n  body: {"error":{}}',
    );
  });

  it("parses a Google error response body", async () => {
    const res = new Response(
      JSON.stringify({
        error: {
          code: 404,
          message: "Tag not found",
          errors: [{ reason: "notFound", message: "Tag not found" }],
        },
      }),
      { status: 404 },
    );
    const err = await GtmApiError.fromResponse(res);
    expect(err.status).toBe(404);
    expect(err.apiMessage).toBe("Tag not found");
    expect(err.message).toContain("resource not found: Tag not found");
    expect(err.message).toContain("reason=notFound");
  });

  it("keeps a non-JSON body in the detail", async () => {
    const res = new Response("<html>gateway error</html>", { status: 502 });
    const err = await GtmApiError.fromResponse(res);
    expect(err.message).toBe("API error 502: \n  body: <html>gateway error</html>");
  });
});

describe("retryWithBackoff", () => {
  it("returns the result on first success", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        return "success";
      },
      3,
      noSleep,
    );
    expect(result).toBe("success");
    expect(calls).toBe(1);
  });

  it("does not retry non-rate-limit errors", async () => {
    let calls = 0;
    const err = new GtmApiError({ status: 400, message: "Bad request" });
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw err;
        },
        3,
        noSleep,
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(1);
  });

  it("does not retry plain errors", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("some other error");
        },
        3,
        noSleep,
      ),
    ).rejects.toThrow("some other error");
    expect(calls).toBe(1);
  });

  it("retries 403 rate limit errors", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls <= 2) {
          throw new GtmApiError({ status: 403, message: "Rate limit exceeded" });
        }
        return "success after retry";
      },
      3,
      noSleep,
    );
    expect(result).toBe("success after retry");
    expect(calls).toBe(3);
  });

  it("retries 429 rate limit errors", async () => {
    let calls = 0;
    const result = await retryWithBackoff(
      async () => {
        calls++;
        if (calls === 1) {
          throw new GtmApiError({ status: 429, message: "Too many requests" });
        }
        return "success";
      },
      3,
      noSleep,
    );
    expect(result).toBe("success");
    expect(calls).toBe(2);
  });

  it("throws the final error after max retries (initial + N retries)", async () => {
    let calls = 0;
    const err = new GtmApiError({ status: 429, message: "Rate limit exceeded" });
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw err;
        },
        2,
        noSleep,
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(3);
    expect(err.message).toContain("Rate limit exceeded");
  });

  it("uses exponential backoff capped at 8s", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    await expect(
      retryWithBackoff(
        async () => {
          throw new GtmApiError({ status: 429, message: "rate" });
        },
        5,
        sleep,
      ),
    ).rejects.toBeInstanceOf(GtmApiError);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});
