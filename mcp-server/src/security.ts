/**
 * security.ts — Token generation, file management, Origin & token validation,
 * and dynamic extension auto-pairing.
 *
 * Security layers:
 *   1. Ephemeral session token (32-byte crypto random).
 *   2. Origin validation: Whitelist in ~/.domray/allowed_origins.json,
 *      or DOMRAY_EXTENSION_ID env var, or dynamic pairing in dev mode.
 *   3. Constant-time token comparison (crypto.timingSafeEqual).
 *   4. Clean shutdown cleanup.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DOMRAY_DIR = path.join(os.homedir(), ".domray");
const TOKEN_FILE = path.join(DOMRAY_DIR, "session.token");
const ORIGINS_FILE = path.join(DOMRAY_DIR, "allowed_origins.json");
const TOKEN_BYTE_LENGTH = 32;

/** Generates a fresh 64-char hex token, persists it, and returns it. */
export function generateAndPersistToken(): string {
  const token = crypto.randomBytes(TOKEN_BYTE_LENGTH).toString("hex");

  fs.mkdirSync(DOMRAY_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600, encoding: "utf8" });

  console.error(`[DOMRay] Session token written to: ${TOKEN_FILE}`);
  console.error(`[DOMRay] Token: ${token}`);

  return token;
}

/** Removes the token file on clean shutdown. */
export function cleanupToken(): void {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    // Ignore — file may not exist on error paths
  }
}

/** Loads persisted allowed extension IDs. */
export function loadAllowedOrigins(): Set<string> {
  const allowed = new Set<string>();
  try {
    if (fs.existsSync(ORIGINS_FILE)) {
      const content = fs.readFileSync(ORIGINS_FILE, "utf8");
      const list = JSON.parse(content) as string[];
      for (const id of list) {
        allowed.add(id);
      }
    }
  } catch {
    // Fallback to empty if corrupted
  }
  return allowed;
}

/** Persists an extension ID into ~/.domray/allowed_origins.json. */
export function registerAllowedExtension(extensionId: string): void {
  const origins = loadAllowedOrigins();
  origins.add(extensionId);

  fs.mkdirSync(DOMRAY_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    ORIGINS_FILE,
    JSON.stringify(Array.from(origins), null, 2),
    { mode: 0o600, encoding: "utf8" }
  );

  console.error(`[DOMRay Security] Auto-paired and saved Extension ID: ${extensionId}`);
}

/**
 * Validates extension ID format and checks against env var or persisted whitelist.
 * In auto-pairing mode (env unset), registers the extension ID.
 */
export function isAllowedExtensionId(
  extId: string,
  envExtensionId?: string
): boolean {
  if (!extId || !/^[a-p]{32}$/.test(extId)) return false;

  // 1. Check env var if explicitly specified
  if (envExtensionId && envExtensionId !== "UNSET_EXTENSION_ID") {
    return extId === envExtensionId;
  }

  // 2. Check persisted whitelist
  const allowed = loadAllowedOrigins();
  if (allowed.has(extId)) return true;

  // 3. In auto-pairing mode without env restriction, auto-accept and whitelist
  if (!envExtensionId || envExtensionId === "UNSET_EXTENSION_ID") {
    registerAllowedExtension(extId);
    return true;
  }

  return false;
}

/**
 * Validates that the request/WS connection originates from an allowed extension.
 * @param origin   The `Origin` header value (e.g. `chrome-extension://<EXTENSION_ID>`).
 * @param envExtensionId  Extension ID from DOMRAY_EXTENSION_ID env var if set.
 */
export function validateOrigin(
  origin: string | undefined,
  envExtensionId?: string
): boolean {
  if (!origin || !origin.startsWith("chrome-extension://")) return false;

  const extId = origin.replace("chrome-extension://", "").split("/")[0] ?? "";
  return isAllowedExtensionId(extId, envExtensionId);
}

/**
 * Constant-time token comparison to prevent timing attacks.
 */
export function validateToken(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}
