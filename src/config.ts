import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fail } from "./errors.js";

/**
 * Where ticktick-axi keeps its files. Override with TICKTICK_AXI_CONFIG_DIR.
 * Linux/macOS: $XDG_CONFIG_HOME/ticktick-axi or ~/.config/ticktick-axi.
 * Windows: %APPDATA%\ticktick-axi.
 */
export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.TICKTICK_AXI_CONFIG_DIR) return env.TICKTICK_AXI_CONFIG_DIR;
  if (platform === "win32" && env.APPDATA) {
    return join(env.APPDATA, "ticktick-axi");
  }
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "ticktick-axi");
}

export const tokenPath = () => join(configDir(), "token.json");
export const clientConfigPath = () => join(configDir(), "config.json");
export const pendingPath = () => join(configDir(), "oauth-pending.json");

export const DEFAULT_REDIRECT_URI = "http://localhost:8765/callback";
export const OAUTH_SCOPES = "tasks:read tasks:write";

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  source: "env" | "file";
}

/**
 * OAuth app credentials: TICKTICK_CLIENT_ID / TICKTICK_CLIENT_SECRET
 * (and optional TICKTICK_REDIRECT_URI) win over config.json.
 * Returns null when neither source provides both id and secret.
 */
export function readClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): ClientConfig | null {
  if (env.TICKTICK_CLIENT_ID && env.TICKTICK_CLIENT_SECRET) {
    return {
      clientId: env.TICKTICK_CLIENT_ID,
      clientSecret: env.TICKTICK_CLIENT_SECRET,
      redirectUri: env.TICKTICK_REDIRECT_URI || DEFAULT_REDIRECT_URI,
      source: "env",
    };
  }
  const file = readJson(clientConfigPath());
  if (
    file &&
    typeof file.clientId === "string" &&
    typeof file.clientSecret === "string" &&
    file.clientId &&
    file.clientSecret
  ) {
    return {
      clientId: file.clientId,
      clientSecret: file.clientSecret,
      redirectUri:
        env.TICKTICK_REDIRECT_URI ||
        (typeof file.redirectUri === "string" && file.redirectUri) ||
        DEFAULT_REDIRECT_URI,
      source: "file",
    };
  }
  return null;
}

export interface StoredToken {
  accessToken: string;
  kind: "oauth" | "personal";
  scope?: string;
  obtainedAt: string;
  /** Only set when the token endpoint returned `expires_in`. */
  expiresAt?: string;
}

export interface ResolvedToken extends Partial<StoredToken> {
  accessToken: string;
  source: "env" | "file";
}

/** TICKTICK_ACCESS_TOKEN overrides the stored token. */
export function readToken(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedToken | null {
  if (env.TICKTICK_ACCESS_TOKEN) {
    return { accessToken: env.TICKTICK_ACCESS_TOKEN.trim(), source: "env" };
  }
  const stored = readStoredToken();
  return stored ? { ...stored, source: "file" } : null;
}

export function readStoredToken(): StoredToken | null {
  const file = readJson(tokenPath());
  if (!file || typeof file.accessToken !== "string" || !file.accessToken) {
    return null;
  }
  return file as unknown as StoredToken;
}

export function writeStoredToken(token: StoredToken): void {
  writePrivateJson(tokenPath(), token);
}

/** Returns true when a stored token existed and was removed. */
export function deleteStoredToken(): boolean {
  const p = tokenPath();
  if (!existsSync(p)) return false;
  rmSync(p, { force: true });
  return true;
}

export interface PendingLogin {
  state: string;
  redirectUri: string;
  createdAt: string;
}

export function writePending(p: PendingLogin): void {
  writePrivateJson(pendingPath(), p);
}

export function readPending(): PendingLogin | null {
  const file = readJson(pendingPath());
  if (!file || typeof file.state !== "string") return null;
  return file as unknown as PendingLogin;
}

export function clearPending(): void {
  rmSync(pendingPath(), { force: true });
}

/**
 * Write JSON readable by the owner only: the directory is 0700 and the file
 * 0600, written to a temp file first and renamed so a crash never leaves a
 * half-written token behind.
 */
export function writePrivateJson(path: string, data: unknown): void {
  const dir = configDir();
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  } catch (e) {
    throw fail(
      "CONFIG_ERROR",
      `Could not write ${path}: ${(e as NodeJS.ErrnoException).code ?? "write failed"}`,
      `Check that ${dir} is writable, or set TICKTICK_AXI_CONFIG_DIR to another directory`,
    );
  }
}

/** Octal permission string such as "600", or null on Windows / missing file. */
export function filePermissions(path: string): string | null {
  if (process.platform === "win32" || !existsSync(path)) return null;
  return (statSync(path).mode & 0o777).toString(8);
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    throw fail(
      "CONFIG_ERROR",
      `${path} is not valid JSON`,
      `Fix or delete ${path}, then rerun the command`,
    );
  }
}
