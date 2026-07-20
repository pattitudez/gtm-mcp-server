/**
 * Parse a stringified-JSON tool parameter (the parametersJson / filterJson /
 * setupTagJson pattern inherited from the Go server). Empty or omitted
 * strings mean "not provided".
 */
export function parseJsonParam<T>(
  raw: string | undefined,
  fieldName: string,
): T | undefined {
  if (raw === undefined || raw === "") return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid ${fieldName}: ${detail}`);
  }
}

/** Split the comma-separated consentTypes string, trimming blanks. */
export function splitConsentTypes(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const types = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  return types.length > 0 ? types : undefined;
}
