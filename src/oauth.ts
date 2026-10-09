import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { ClientConfig } from "./config.js";
import { OAUTH_SCOPES } from "./config.js";
import { fail } from "./errors.js";
import { redact, safeJson } from "./http.js";

/**
 * OAuth2 authorization-code flow, per https://developer.ticktick.com/docs#/openapi
 *   1. Browser -> https://ticktick.com/oauth/authorize?client_id&scope&state&redirect_uri&response_type=code
 *   2. TickTick redirects to redirect_uri?code=...&state=...
 *   3. POST https://ticktick.com/oauth/token (Basic auth client_id:client_secret,
 *      form: code, grant_type=authorization_code, scope, redirect_uri)
 * The docs list no refresh grant, so there is no automatic refresh: when the
 * token stops working the person signs in again.
 */
export function authBase(): string {
  return (process.env.TICKTICK_AXI_AUTH_BASE || "https://ticktick.com").replace(
    /\/$/,
    "",
  );
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthorizeUrl(
  cfg: Pick<ClientConfig, "clientId" | "redirectUri">,
  state: string,
): string {
  const u = new URL(`${authBase()}/oauth/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("scope", OAUTH_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_type", "code");
  return u.toString();
}

export interface TokenResponse {
  accessToken: string;
  scope?: string;
  expiresIn?: number;
}

/** Exchange an authorization code for an access token. Never retried: codes are single-use. */
export async function exchangeCode(
  cfg: ClientConfig,
  code: string,
): Promise<TokenResponse> {
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    "base64",
  );
  const form = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    scope: OAUTH_SCOPES,
    redirect_uri: cfg.redirectUri,
  });
  let res: Response;
  try {
    res = await fetch(`${authBase()}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
  } catch {
    throw fail(
      "NETWORK_ERROR",
      "Could not reach TickTick to finish signing in (network failure)",
      "Check your connection, then run `ticktick-axi auth login` again (the code is single-use)",
    );
  }
  const parsed = safeJson(await res.text().catch(() => ""));
  if (!res.ok || typeof parsed.access_token !== "string") {
    const raw =
      typeof parsed.error_description === "string"
        ? parsed.error_description
        : typeof parsed.error === "string"
          ? parsed.error
          : `HTTP ${res.status}`;
    const detail = redact(raw, cfg.clientSecret, code).slice(0, 200);
    throw fail(
      "OAUTH_ERROR",
      `TickTick did not issue a token (${detail})`,
      "Check TICKTICK_CLIENT_ID / TICKTICK_CLIENT_SECRET and that the redirect URI matches the one registered at https://developer.ticktick.com/manage",
      "Then run `ticktick-axi auth login` again",
    );
  }
  return {
    accessToken: parsed.access_token,
    scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
    expiresIn:
      typeof parsed.expires_in === "number" ? parsed.expires_in : undefined,
  };
}

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
}

export function parseCallbackUrl(input: string): CallbackParams {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return {};
  }
  return {
    code: u.searchParams.get("code") ?? undefined,
    state: u.searchParams.get("state") ?? undefined,
    error: u.searchParams.get("error") ?? undefined,
  };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopback(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

const PAGE = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>ticktick-axi</title><p style="font:16px system-ui;margin:3em">${msg}</p>`;

/**
 * Listen on the loopback redirect URI until TickTick redirects back with a
 * code whose `state` matches. Requests with a wrong state get a 400 and the
 * wait continues, so a stray local request cannot hijack or abort the flow.
 */
export function waitForCallback(
  redirectUri: string,
  state: string,
  timeoutMs: number,
): Promise<string> {
  const target = new URL(redirectUri);
  const port = Number(target.port || 80);
  const hosts =
    target.hostname === "localhost"
      ? ["127.0.0.1", "::1"]
      : [target.hostname.replace(/^\[|\]$/g, "")];

  return new Promise<string>((resolve, reject) => {
    const servers: Server[] = [];
    let settled = false;
    const finish = (err: Error | null, code?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const s of servers) s.close();
      if (err) reject(err);
      else resolve(code as string);
    };
    const timer = setTimeout(
      () =>
        finish(
          fail(
            "OAUTH_ERROR",
            `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the TickTick redirect`,
            "Run `ticktick-axi auth login` again and approve in the browser, or use `ticktick-axi auth login --no-wait` then `--callback-url '<url>'`",
          ),
        ),
      timeoutMs,
    );

    const handler: Parameters<typeof createServer>[1] = (req, res) => {
      const u = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      );
      if (u.pathname !== target.pathname) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const error = u.searchParams.get("error");
      const gotState = u.searchParams.get("state");
      const code = u.searchParams.get("code");
      if (gotState !== state) {
        res
          .writeHead(400, { "Content-Type": "text/html" })
          .end(
            PAGE(
              "This sign-in link is stale or invalid. Return to the terminal.",
            ),
          );
        return;
      }
      if (error || !code) {
        res
          .writeHead(400, { "Content-Type": "text/html" })
          .end(PAGE("TickTick did not grant access. You can close this tab."));
        finish(
          fail(
            "OAUTH_ERROR",
            `TickTick authorization was not granted (${error ?? "no code"})`,
            "Run `ticktick-axi auth login` again and choose Allow",
          ),
        );
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(PAGE("ticktick-axi is signed in. You can close this tab."));
      finish(null, code);
    };

    hosts.forEach((host, i) => {
      const server = createServer(handler);
      servers.push(server);
      server.on("error", (e: NodeJS.ErrnoException) => {
        // The IPv6 loopback is best-effort; only the first host is required.
        if (i > 0) return;
        finish(
          fail(
            "CONFIG_ERROR",
            e.code === "EADDRINUSE"
              ? `Port ${port} is already in use, so the sign-in redirect cannot be received`
              : `Could not listen on ${redirectUri} (${e.code ?? "error"})`,
            "Stop whatever uses that port, or register another loopback redirect URI and set TICKTICK_REDIRECT_URI to it",
          ),
        );
      });
      server.listen(port, host);
    });
  });
}
