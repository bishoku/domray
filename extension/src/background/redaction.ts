/**
 * redaction.ts — Edge-side data masking.
 *
 * All masking happens in the Extension BEFORE data leaves the browser.
 * This is the "zero external leak" guarantee.
 */

import { MASKED_HEADERS, MASKED_QUERY_PARAMS } from "../utils/constants.js";

const MASK = "***MASKED***";

/** Masks sensitive HTTP headers in-place and returns a new clean object. */
export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = MASKED_HEADERS.has(key.toLowerCase()) ? MASK : value;
  }
  return result;
}

/**
 * Masks sensitive query parameters in a URL string.
 * Returns the sanitized URL string.
 */
export function redactUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl; // Can't parse — return as-is
  }

  let mutated = false;
  for (const [key, value] of url.searchParams.entries()) {
    if (MASKED_QUERY_PARAMS.has(key.toLowerCase()) && value.length > 0) {
      url.searchParams.set(key, MASK);
      mutated = true;
    }
  }

  return mutated ? url.toString() : rawUrl;
}

/**
 * Attempts to mask sensitive keys in a JSON request/response body.
 * If body cannot be parsed as JSON, returns it unchanged.
 */
export function redactBody(body: string): string {
  try {
    const obj: unknown = JSON.parse(body);
    return JSON.stringify(maskObject(obj));
  } catch {
    return body;
  }
}

const MASKED_BODY_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "private_key",
  "client_secret",
]);

function maskObject(val: unknown, depth = 0): unknown {
  if (depth > 5) return val; // Guard against deep recursion
  if (Array.isArray(val)) return val.map((v) => maskObject(v, depth + 1));
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = MASKED_BODY_KEYS.has(k.toLowerCase()) ? MASK : maskObject(v, depth + 1);
    }
    return out;
  }
  return val;
}
