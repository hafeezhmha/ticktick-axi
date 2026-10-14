import { AxiError, exitCodeForError } from "axi-sdk-js";

export { AxiError, exitCodeForError };

/**
 * Error codes this CLI emits. `VALIDATION_ERROR` maps to exit code 2 (usage);
 * everything else is exit code 1. Agents branch on `code`, so keep these stable.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_REQUIRED"
  | "TOKEN_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "WRITE_UNCERTAIN"
  | "API_ERROR"
  | "OAUTH_ERROR"
  | "CONFIG_ERROR";

/**
 * Run a pre-read for a delete: NOT_FOUND becomes null so the delete can be an
 * idempotent no-op (exit 0) instead of an error. Anything else still throws.
 */
export async function orGone<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (e) {
    if (e instanceof AxiError && e.code === "NOT_FOUND") return null;
    throw e;
  }
}

/** The result of deleting something that is not there. */
export function goneResult(what: string, listHint: string) {
  return {
    result: `${what} not found: already deleted, or the id is wrong (no-op)`,
    help: [listHint],
  };
}

/** Build a usage error (exit code 2) with actionable next-step suggestions. */
export function usage(message: string, ...suggestions: string[]): AxiError {
  return new AxiError(message, "VALIDATION_ERROR", suggestions);
}

/** Build a runtime error (exit code 1) with a stable code and suggestions. */
export function fail(
  code: Exclude<ErrorCode, "VALIDATION_ERROR">,
  message: string,
  ...suggestions: string[]
): AxiError {
  return new AxiError(message, code, suggestions);
}
