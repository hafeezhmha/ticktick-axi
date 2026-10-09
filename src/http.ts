import { fail } from "./errors.js";
import type { ResolvedToken } from "./config.js";

export const API_BASE = "https://api.ticktick.com/open/v1";

/** Indirection so tests can skip real waiting between retries. */
export const timing = {
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

export const RETRY = {
  /** Retries after the first attempt, for reads only. */
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  /** A Retry-After longer than this is reported instead of waited out. */
  maxRetryAfterMs: 30000,
};

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface RequestOptions {
  body?: unknown;
  /**
   * True for calls that change nothing (GETs, and the POST-based query
   * endpoints like /task/filter). Only these are retried. Writes are never
   * retried automatically: a timed-out create may already have landed.
   */
  read: boolean;
  /** Human label for 404s, e.g. "task 63b7... in project 6226...". */
  what?: string;
}

/** Thin TickTick Open API client: auth header, retries, error translation. */
export class TickTickClient {
  constructor(
    private readonly token: ResolvedToken,
    private readonly base: string = process.env.TICKTICK_AXI_API_BASE ||
      API_BASE,
  ) {}

  async request<T = unknown>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: RequestOptions,
  ): Promise<T> {
    if (
      this.token.expiresAt &&
      Date.parse(this.token.expiresAt) <= Date.now()
    ) {
      throw expiredError(this.token);
    }
    const url = `${this.base}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token.accessToken}`,
        Accept: "application/json",
        ...(opts.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    };

    const attempts = opts.read ? RETRY.maxRetries + 1 : 1;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= attempts - 1;
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch {
        if (!last) {
          await timing.sleep(backoff(attempt));
          continue;
        }
        if (!opts.read) {
          throw fail(
            "WRITE_UNCERTAIN",
            "Network failure while sending a change to TickTick; it may or may not have been applied",
            "Check the current state before retrying (e.g. `ticktick-axi task <projectId> <taskId>` or `ticktick-axi tasks --project <projectId>`)",
          );
        }
        throw fail(
          "NETWORK_ERROR",
          "Could not reach TickTick (network failure)",
          "Check your internet connection, then rerun the command",
        );
      }

      if (res.ok) return (await parseBody(res)) as T;

      if (RETRYABLE_STATUS.has(res.status) && !last) {
        const wait = retryAfterMs(res.headers.get("retry-after"));
        if (wait === null || wait <= RETRY.maxRetryAfterMs) {
          await timing.sleep(wait ?? backoff(attempt));
          continue;
        }
      }
      throw await translateError(res, this.token, opts);
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(RETRY.baseDelayMs * 2 ** attempt, RETRY.maxDelayMs);
}

/** Parse Retry-After (delta-seconds or HTTP-date) into ms; null if absent. */
export function retryAfterMs(
  header: string | null,
  now: number = Date.now(),
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw fail(
      "API_ERROR",
      "TickTick returned a response that is not JSON",
      "Rerun the command; if it keeps happening the API may be degraded",
    );
  }
}

function expiredError(token: ResolvedToken) {
  return fail(
    "TOKEN_EXPIRED",
    token.source === "env"
      ? "TickTick rejected TICKTICK_ACCESS_TOKEN (expired or revoked)"
      : "Your TickTick login has expired or was revoked",
    token.source === "env"
      ? "Replace TICKTICK_ACCESS_TOKEN with a fresh token, or unset it and run `ticktick-axi auth login`"
      : "Run `ticktick-axi auth login` to sign in again",
  );
}

async function translateError(
  res: Response,
  token: ResolvedToken,
  opts: RequestOptions,
) {
  const detail = await errorDetail(res, token.accessToken);
  const suffix = detail ? ` (${detail})` : "";
  switch (res.status) {
    case 401:
      return expiredError(token);
    case 403:
      return fail(
        "FORBIDDEN",
        `TickTick refused access${suffix}`,
        "The token may lack the tasks:read/tasks:write scope, or you lack permission on this project",
        "Run `ticktick-axi auth login` to grant both scopes again",
      );
    case 404:
      return fail(
        "NOT_FOUND",
        `Not found: ${opts.what ?? "resource"}`,
        "Run `ticktick-axi projects` to list project ids, or `ticktick-axi tasks` to find task ids",
      );
    case 429: {
      const wait = retryAfterMs(res.headers.get("retry-after"));
      const when =
        wait !== null ? ` Retry after ${Math.ceil(wait / 1000)}s.` : "";
      return fail(
        "RATE_LIMITED",
        `TickTick rate limit reached.${when}`,
        opts.read
          ? "Wait a minute, then rerun the command"
          : "The change was rejected, not applied; it is safe to rerun after a short wait",
      );
    }
    default:
      if (res.status >= 500) {
        return fail(
          "API_ERROR",
          `TickTick server error ${res.status}${suffix}`,
          opts.read
            ? "TickTick may be degraded; rerun in a minute"
            : "Check whether the change landed before retrying (`ticktick-axi task <projectId> <taskId>`)",
        );
      }
      return fail(
        "API_ERROR",
        `TickTick rejected the request with HTTP ${res.status}${suffix}`,
        "Check the ids and values, then rerun; `ticktick-axi <command> --help` lists valid formats",
      );
  }
}

/** Parse JSON leniently: anything that is not a JSON object becomes {}. */
export function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Pull a short, safe message out of an error body; never echo the token. */
async function errorDetail(
  res: Response,
  accessToken: string,
): Promise<string> {
  const body = safeJson(await res.text().catch(() => ""));
  const msg = [body.errorMessage, body.message, body.error_description].find(
    (v): v is string => typeof v === "string",
  );
  return redact(msg ?? "", accessToken).slice(0, 200);
}

/** Replace every occurrence of a secret with a fixed marker. */
export function redact(text: string, ...secrets: Array<string | undefined>) {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  }
  return out;
}
