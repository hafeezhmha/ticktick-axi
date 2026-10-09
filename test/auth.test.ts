import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authIo } from "../src/commands/auth.js";
import { pendingPath, tokenPath, writeStoredToken } from "../src/config.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  isLoopback,
  parseCallbackUrl,
  waitForCallback,
} from "../src/oauth.js";
import {
  API,
  FAKE_CLIENT_ID,
  FAKE_SECRET,
  FAKE_TOKEN,
  isolate,
  json,
  mockFetch,
  run,
} from "./support.js";

const originalIo = { ...authIo };
let dir: string;
beforeEach(() => {
  dir = isolate({ token: false });
  Object.assign(authIo, originalIo);
});

function withClient(redirect?: string) {
  vi.stubEnv("TICKTICK_CLIENT_ID", FAKE_CLIENT_ID);
  vi.stubEnv("TICKTICK_CLIENT_SECRET", FAKE_SECRET);
  if (redirect) vi.stubEnv("TICKTICK_REDIRECT_URI", redirect);
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** Simulate the browser hitting the loopback redirect (no fetch: it is mocked). */
function hit(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on("error", reject)
      .end();
  });
}

const tokenRoute = (
  body: unknown = {
    access_token: FAKE_TOKEN,
    token_type: "bearer",
    expires_in: 15551999,
    scope: "tasks:read tasks:write",
  },
  status = 200,
) => ({
  method: "POST",
  url: /ticktick\.com\/oauth\/token$/,
  res: json(body, status),
});

describe("oauth helpers", () => {
  it("builds the documented authorize URL", () => {
    const u = new URL(
      buildAuthorizeUrl(
        {
          clientId: FAKE_CLIENT_ID,
          redirectUri: "http://localhost:8765/callback",
        },
        "st",
      ),
    );
    expect(u.origin + u.pathname).toBe("https://ticktick.com/oauth/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: FAKE_CLIENT_ID,
      scope: "tasks:read tasks:write",
      state: "st",
      redirect_uri: "http://localhost:8765/callback",
      response_type: "code",
    });
  });

  it("supports a different auth host (e.g. dida365)", () => {
    vi.stubEnv("TICKTICK_AXI_AUTH_BASE", "https://dida365.com/");
    expect(buildAuthorizeUrl({ clientId: "a", redirectUri: "b" }, "s")).toMatch(
      /^https:\/\/dida365\.com\/oauth\/authorize\?/,
    );
  });

  it("exchanges a code with Basic auth and a form body", async () => {
    const calls = mockFetch([tokenRoute()]);
    const t = await exchangeCode(
      {
        clientId: FAKE_CLIENT_ID,
        clientSecret: FAKE_SECRET,
        redirectUri: "http://localhost:8765/callback",
        source: "env",
      },
      "the-code",
    );
    expect(t).toEqual({
      accessToken: FAKE_TOKEN,
      scope: "tasks:read tasks:write",
      expiresIn: 15551999,
    });
    expect(calls[0].headers.Authorization).toBe(
      `Basic ${Buffer.from(`${FAKE_CLIENT_ID}:${FAKE_SECRET}`).toString("base64")}`,
    );
    expect(calls[0].headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(
      Object.fromEntries(new URLSearchParams(calls[0].body as string)),
    ).toEqual({
      code: "the-code",
      grant_type: "authorization_code",
      scope: "tasks:read tasks:write",
      redirect_uri: "http://localhost:8765/callback",
    });
  });

  it("reports token endpoint failures without leaking the secret or code", async () => {
    mockFetch([
      tokenRoute(
        {
          error: "invalid_client",
          error_description: `bad ${FAKE_SECRET} the-code`,
        },
        401,
      ),
    ]);
    const e: any = await exchangeCode(
      {
        clientId: "a",
        clientSecret: FAKE_SECRET,
        redirectUri: "r",
        source: "env",
      },
      "the-code",
    ).catch((x) => x);
    expect(e.code).toBe("OAUTH_ERROR");
    expect(e.message).not.toContain(FAKE_SECRET);
    expect(e.message).not.toContain("the-code");
    mockFetch([tokenRoute({ error: "invalid_grant" }, 400)]);
    const e2: any = await exchangeCode(
      {
        clientId: "a",
        clientSecret: FAKE_SECRET,
        redirectUri: "r",
        source: "env",
      },
      "c0de",
    ).catch((x) => x);
    expect(e2.message).toContain("invalid_grant");
    mockFetch([{ url: /./, res: new Response("oops", { status: 502 }) }]);
    const e3: any = await exchangeCode(
      {
        clientId: "a",
        clientSecret: FAKE_SECRET,
        redirectUri: "r",
        source: "env",
      },
      "c0de",
    ).catch((x) => x);
    expect(e3.message).toContain("HTTP 502");
  });

  it("reports network failures during the exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("down");
      }),
    );
    const e: any = await exchangeCode(
      { clientId: "a", clientSecret: "b", redirectUri: "r", source: "env" },
      "c",
    ).catch((x) => x);
    expect(e.code).toBe("NETWORK_ERROR");
  });

  it("parses callback URLs and recognises loopback redirects", () => {
    expect(
      parseCallbackUrl("http://localhost:8765/callback?code=c&state=s"),
    ).toEqual({ code: "c", state: "s", error: undefined });
    expect(parseCallbackUrl("not a url")).toEqual({});
    expect(isLoopback("http://localhost:8765/callback")).toBe(true);
    expect(isLoopback("http://127.0.0.1:1/x")).toBe(true);
    expect(isLoopback("https://example.com/cb")).toBe(false);
    expect(isLoopback("::")).toBe(false);
  });
});

describe("loopback listener", () => {
  it("ignores wrong paths and states, then resolves with the code", async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const p = waitForCallback(`${base}/callback`, "good", 5000);
    await new Promise((r) => setTimeout(r, 50));
    expect(await hit(`${base}/other`)).toBe(404);
    expect(await hit(`${base}/callback?code=x&state=evil`)).toBe(400);
    expect(await hit(`${base}/callback?code=the-code&state=good`)).toBe(200);
    await expect(p).resolves.toBe("the-code");
  });

  it("rejects when the person denies access", async () => {
    const port = await freePort();
    const p = waitForCallback(`http://127.0.0.1:${port}/cb`, "s", 5000).catch(
      (e) => e,
    );
    await new Promise((r) => setTimeout(r, 50));
    await hit(`http://127.0.0.1:${port}/cb?error=access_denied&state=s`);
    expect(await p).toMatchObject({ code: "OAUTH_ERROR" });
  });

  it("times out", async () => {
    const port = await freePort();
    await expect(
      waitForCallback(`http://127.0.0.1:${port}/cb`, "s", 50),
    ).rejects.toMatchObject({
      code: "OAUTH_ERROR",
      message: expect.stringContaining("Timed out"),
    });
  });

  it("reports a busy port", async () => {
    const blocker = createNetServer();
    const port = await new Promise<number>((r) =>
      blocker.listen(0, "127.0.0.1", () =>
        r((blocker.address() as { port: number }).port),
      ),
    );
    await expect(
      waitForCallback(`http://127.0.0.1:${port}/cb`, "s", 2000),
    ).rejects.toMatchObject({
      code: "CONFIG_ERROR",
      message: expect.stringContaining("already in use"),
    });
    blocker.close();
  });

  it("binds both loopbacks for localhost", async () => {
    const port = await freePort();
    const p = waitForCallback(`http://localhost:${port}/cb`, "s", 5000);
    await new Promise((r) => setTimeout(r, 50));
    await hit(`http://127.0.0.1:${port}/cb?code=c&state=s`);
    await expect(p).resolves.toBe("c");
  });
});

describe("auth login", () => {
  it("runs the full loopback flow and stores the token 0600", async () => {
    const port = await freePort();
    withClient(`http://127.0.0.1:${port}/callback`);
    mockFetch([tokenRoute()]);
    const logs: string[] = [];
    authIo.stderr = (s) => {
      logs.push(s);
      const url = new URL(/https:\/\/\S+/.exec(s)![0]);
      setTimeout(() => {
        void hit(
          `http://127.0.0.1:${port}/callback?code=c0de&state=${url.searchParams.get("state")}`,
        );
      }, 30);
    };
    const { out, code } = await run("auth", "login", "--timeout", "10");
    expect(code).toBe(0);
    expect(logs[0]).toContain("https://ticktick.com/oauth/authorize?");
    expect(out).toContain("auth: signed in (OAuth)");
    expect(out).toContain('scope: "tasks:read tasks:write"');
    expect(out).toContain('expires: "2027-04-07');
    const stored = JSON.parse(readFileSync(tokenPath(), "utf-8"));
    expect(stored).toMatchObject({ accessToken: FAKE_TOKEN, kind: "oauth" });
    expect(stored.refreshToken).toBeUndefined();
    if (process.platform !== "win32") {
      expect((await import("node:fs")).statSync(tokenPath()).mode & 0o777).toBe(
        0o600,
      );
    }
    expect(out).not.toContain(FAKE_TOKEN);
  });

  it("needs OAuth app credentials", async () => {
    const { out, code } = await run("auth", "login");
    expect(code).toBe(1);
    expect(out).toContain("code: CONFIG_ERROR");
    expect(out).toContain("TICKTICK_CLIENT_ID");
  });

  it("reads credentials from config.json too", async () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        clientId: "a",
        clientSecret: "b",
        redirectUri: "https://example.com/cb",
      }),
    );
    const { out, code } = await run("auth", "login");
    expect(code).toBe(1);
    expect(out).toContain("not a local http://localhost");
  });

  it("--no-wait prints the URL, then --callback-url finishes", async () => {
    withClient();
    mockFetch([tokenRoute({ access_token: FAKE_TOKEN })]);
    const first = await run("auth", "login", "--no-wait");
    expect(first.code).toBe(0);
    expect(first.out).toContain("authorize_url: ");
    expect(existsSync(pendingPath())).toBe(true);
    const state = JSON.parse(readFileSync(pendingPath(), "utf-8")).state;

    const bad = await run(
      "auth",
      "login",
      "--callback-url",
      `http://localhost:8765/callback?code=c&state=wrong`,
    );
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("does not match");

    const incomplete = await run(
      "auth",
      "login",
      "--callback-url",
      "http://localhost:8765/callback",
    );
    expect(incomplete.code).toBe(2);

    const ok = await run(
      "auth",
      "login",
      "--callback-url",
      `http://localhost:8765/callback?code=c&state=${state}`,
    );
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("signed in (OAuth)");
    expect(ok.out).toContain("expires: not reported by TickTick");
    expect(existsSync(pendingPath())).toBe(false);
  });

  it("--callback-url without a pending login, stale, or denied", async () => {
    withClient();
    expect(
      (await run("auth", "login", "--callback-url", "http://x/?code=a&state=b"))
        .out,
    ).toContain("No sign-in is waiting");
    writeFileSync(
      pendingPath(),
      JSON.stringify({
        state: "s",
        redirectUri: "r",
        createdAt: "2026-10-09T05:00:00Z",
      }),
    );
    expect(
      (await run("auth", "login", "--callback-url", "http://x/?code=a&state=s"))
        .out,
    ).toContain("expired");
    writeFileSync(
      pendingPath(),
      JSON.stringify({
        state: "s",
        redirectUri: "r",
        createdAt: "2026-10-09T06:29:00Z",
      }),
    );
    expect(
      (
        await run(
          "auth",
          "login",
          "--callback-url",
          "http://x/?error=access_denied&state=s",
        )
      ).out,
    ).toContain("not granted (access_denied)");
  });

  it("--token-stdin stores a personal API token", async () => {
    authIo.stdinIsTTY = () => false;
    authIo.readStdin = async () => `  ${FAKE_TOKEN}\n`;
    const { out, code } = await run("auth", "login", "--token-stdin");
    expect(code).toBe(0);
    expect(out).toContain("signed in (personal API token)");
    expect(out).not.toContain(FAKE_TOKEN);
    expect(JSON.parse(readFileSync(tokenPath(), "utf-8"))).toMatchObject({
      accessToken: FAKE_TOKEN,
      kind: "personal",
    });
  });

  it("--token-stdin refuses a keyboard and junk input", async () => {
    authIo.stdinIsTTY = () => true;
    expect((await run("auth", "login", "--token-stdin")).code).toBe(2);
    authIo.stdinIsTTY = () => false;
    authIo.readStdin = async () => "two words";
    expect((await run("auth", "login", "--token-stdin")).out).toContain(
      "single API token",
    );
  });

  it("refuses tokens as arguments and conflicting modes", async () => {
    const t = await run("auth", "login", "--token", FAKE_TOKEN);
    expect(t.code).toBe(2);
    expect(t.out).toContain("shell history");
    expect(t.out).not.toContain(FAKE_TOKEN);
    expect(
      (await run("auth", "login", "--no-wait", "--token-stdin")).out,
    ).toContain("pick one");
    expect((await run("auth", "login", "now")).code).toBe(2);
  });

  it("notes when an env token shadows the stored one", async () => {
    vi.stubEnv("TICKTICK_ACCESS_TOKEN", "env-token-not-real");
    authIo.stdinIsTTY = () => false;
    authIo.readStdin = async () => FAKE_TOKEN;
    const { out } = await run("auth", "login", "--token-stdin");
    expect(out).toContain("takes precedence");
  });
});

describe("auth status", () => {
  it("reports not signed in", async () => {
    const { out, code } = await run("auth", "status");
    expect(code).toBe(0);
    expect(out).toContain("auth: not signed in");
    expect(out).toContain("oauth_app: not configured");
    expect((await run("auth")).out).toContain("auth: not signed in");
  });

  it("describes the stored token without printing it", async () => {
    withClient();
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "oauth",
      scope: "tasks:read tasks:write",
      obtainedAt: "2026-10-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
    });
    const { out } = await run("auth", "status");
    expect(out).toContain("signed_in: true");
    expect(out).toContain("kind: OAuth");
    expect(out).toContain("token: present (never printed)");
    if (process.platform !== "win32")
      expect(out).toContain('permissions: "600"');
    expect(out).toContain("TICKTICK_CLIENT_ID/SECRET");
    expect(out).not.toContain(FAKE_TOKEN);
  });

  it("flags expired tokens and loose permissions", async () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ clientId: "a", clientSecret: "b" }),
    );
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "personal",
      obtainedAt: "x",
      expiresAt: "2020-01-01T00:00:00Z",
    });
    let r = await run("auth", "status");
    expect(r.out).toContain("expired: true");
    expect(r.out).toContain("kind: personal API token");
    expect(r.out).toContain("config.json");
    if (process.platform !== "win32") {
      writeStoredToken({
        accessToken: FAKE_TOKEN,
        kind: "personal",
        obtainedAt: "x",
      });
      chmodSync(tokenPath(), 0o644);
      r = await run("auth", "status");
      expect(r.out).toContain("too open");
      expect(r.out).toContain("chmod 600");
    }
  });

  it("--verify makes one read call", async () => {
    vi.stubEnv("TICKTICK_ACCESS_TOKEN", FAKE_TOKEN);
    const calls = mockFetch([{ url: /\/project$/, res: json([{ id: "p" }]) }]);
    const { out } = await run("auth", "status", "--verify");
    expect(calls[0].url).toBe(`${API}/project`);
    expect(out).toContain("source: TICKTICK_ACCESS_TOKEN environment variable");
    expect(out).toContain(
      "verified: TickTick accepted the token (1 projects visible)",
    );
    mockFetch([{ url: /./, res: json({}, 401) }]);
    const bad = await run("auth", "status", "--verify");
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("TOKEN_EXPIRED");
  });

  it("rejects unknown subcommands and arguments", async () => {
    expect((await run("auth", "whoami")).code).toBe(2);
    expect((await run("auth", "status", "x")).code).toBe(2);
    expect((await run("auth", "logout", "x")).code).toBe(2);
  });
});

describe("auth logout", () => {
  it("is idempotent", async () => {
    const { out, code } = await run("auth", "logout");
    expect(code).toBe(0);
    expect(out).toContain("already signed out");
  });

  it("removes the stored token and mentions an env token", async () => {
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "oauth",
      obtainedAt: "x",
    });
    vi.stubEnv("TICKTICK_ACCESS_TOKEN", "env-token-not-real");
    const { out } = await run("auth", "logout");
    expect(out).toContain("signed out: removed");
    expect(out).toContain("still set");
    expect(existsSync(tokenPath())).toBe(false);
  });

  it("--revoke calls the documented revoke endpoint first", async () => {
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "oauth",
      obtainedAt: "x",
    });
    const calls = mockFetch([
      {
        method: "POST",
        url: /api\.ticktick\.com\/oauth\/revoke$/,
        res: new Response("", { status: 200 }),
      },
    ]);
    const { out } = await run("auth", "logout", "--revoke");
    expect(calls[0].body).toBeInstanceOf(FormData);
    expect((calls[0].body as FormData).get("token")).toBe(FAKE_TOKEN);
    expect(out).toContain("revoke: revoked at TickTick");
    expect(out).not.toContain(FAKE_TOKEN);
  });

  it("--revoke failures are reported but logout still happens", async () => {
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "oauth",
      obtainedAt: "x",
    });
    mockFetch([{ url: /revoke$/, res: new Response("", { status: 401 }) }]);
    expect((await run("auth", "logout", "--revoke")).out).toContain(
      "did not confirm revocation",
    );
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "oauth",
      obtainedAt: "x",
    });
    vi.stubEnv("TICKTICK_AXI_API_BASE", "https://api.dida365.com/open/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("down");
      }),
    );
    const r = await run("auth", "logout", "--revoke");
    expect(r.out).toContain("could not reach TickTick");
    expect(existsSync(tokenPath())).toBe(false);
  });
});
