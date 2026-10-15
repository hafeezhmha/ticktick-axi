import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  redact,
  retryAfterMs,
  RETRY,
  timing,
  TickTickClient,
} from "../src/http.js";
import { authBase } from "../src/oauth.js";
import { API, FAKE_TOKEN, isolate, json, mockFetch } from "./support.js";

const client = (extra: Record<string, unknown> = {}) =>
  new TickTickClient({ accessToken: FAKE_TOKEN, source: "file", ...extra });

async function err(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  isolate();
});

describe("TickTickClient", () => {
  it("sends the bearer token and JSON body, and parses JSON", async () => {
    const calls = mockFetch([
      { url: /\/task\/filter$/, res: json([{ id: "1" }]) },
    ]);
    const out = await client().request("POST", "/task/filter", {
      body: { status: [0] },
      read: true,
    });
    expect(out).toEqual([{ id: "1" }]);
    expect(calls[0].url).toBe(`${API}/task/filter`);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].body).toEqual({ status: [0] });
  });

  it("returns null for empty success bodies", async () => {
    mockFetch([{ url: /complete$/, res: new Response("", { status: 200 }) }]);
    await expect(
      client().request("POST", "/project/p/task/t/complete", { read: false }),
    ).resolves.toBeNull();
  });

  it("honours TICKTICK_AXI_API_BASE", async () => {
    vi.stubEnv("TICKTICK_AXI_API_BASE", "https://api.dida365.com/open/v1");
    const calls = mockFetch([{ url: /dida365/, res: json([]) }]);
    await client().request("GET", "/project", { read: true });
    expect(calls[0].url).toBe("https://api.dida365.com/open/v1/project");
  });

  it("refuses a plain-http TICKTICK_AXI_API_BASE before sending the token", async () => {
    vi.stubEnv("TICKTICK_AXI_API_BASE", "http://api.dida365.com/open/v1");
    const calls = mockFetch([]);
    expect(() => client()).toThrow(
      expect.objectContaining({ code: "CONFIG_ERROR" }),
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a plain-http TICKTICK_AXI_AUTH_BASE", () => {
    vi.stubEnv("TICKTICK_AXI_AUTH_BASE", "http://dida365.com");
    expect(() => authBase()).toThrow(
      expect.objectContaining({ code: "CONFIG_ERROR" }),
    );
  });

  it("retries reads on 429, waiting for Retry-After", async () => {
    let n = 0;
    mockFetch([
      {
        url: /\/project$/,
        res: () =>
          ++n === 1
            ? json({}, 429, { "Retry-After": "2" })
            : json([{ id: "p" }]),
      },
    ]);
    await expect(
      client().request("GET", "/project", { read: true }),
    ).resolves.toEqual([{ id: "p" }]);
    expect(timing.sleep).toHaveBeenCalledWith(2000);
  });

  it("retries reads on 5xx with exponential backoff, then reports", async () => {
    const calls = mockFetch([{ url: /\/project$/, res: json({}, 503) }]);
    const e = await err(client().request("GET", "/project", { read: true }));
    expect(e.code).toBe("API_ERROR");
    expect(e.message).toContain("server error 503");
    expect(calls).toHaveLength(RETRY.maxRetries + 1);
    expect(vi.mocked(timing.sleep).mock.calls.map((c) => c[0])).toEqual([
      500, 1000, 2000,
    ]);
  });

  it("gives up on 429 after retries with RATE_LIMITED", async () => {
    mockFetch([
      { url: /\/project$/, res: json({}, 429, { "Retry-After": "1" }) },
    ]);
    const e = await err(client().request("GET", "/project", { read: true }));
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.message).toContain("Retry after 1s");
  });

  it("does not wait out a very long Retry-After", async () => {
    const calls = mockFetch([
      { url: /\/project$/, res: json({}, 429, { "Retry-After": "3600" }) },
    ]);
    const e = await err(client().request("GET", "/project", { read: true }));
    expect(e.code).toBe("RATE_LIMITED");
    expect(calls).toHaveLength(1);
    expect(timing.sleep).not.toHaveBeenCalled();
  });

  it("never retries writes, even on 429", async () => {
    const calls = mockFetch([{ url: /\/task$/, res: json({}, 429) }]);
    const e = await err(
      client().request("POST", "/task", { body: {}, read: false }),
    );
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.suggestions[0]).toContain("rejected, not applied");
    expect(calls).toHaveLength(1);
  });

  it("reports 5xx on writes without retrying, asking to check first", async () => {
    const calls = mockFetch([{ url: /\/task$/, res: json({}, 500) }]);
    const e = await err(
      client().request("POST", "/task", { body: {}, read: false }),
    );
    expect(e.code).toBe("API_ERROR");
    expect(e.suggestions[0]).toContain("Check whether the change landed");
    expect(calls).toHaveLength(1);
  });

  it("retries network failures on reads, then NETWORK_ERROR", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fn);
    const e = await err(client().request("GET", "/project", { read: true }));
    expect(e.code).toBe("NETWORK_ERROR");
    expect(fn).toHaveBeenCalledTimes(RETRY.maxRetries + 1);
  });

  it("flags a network failure during a write as WRITE_UNCERTAIN, no retry", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fn);
    const e = await err(
      client().request("POST", "/task", { body: {}, read: false }),
    );
    expect(e.code).toBe("WRITE_UNCERTAIN");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("maps 401 to TOKEN_EXPIRED with source-specific advice", async () => {
    mockFetch([{ url: /./, res: json({}, 401) }]);
    const fileErr = await err(
      client().request("GET", "/project", { read: true }),
    );
    expect(fileErr.code).toBe("TOKEN_EXPIRED");
    expect(fileErr.suggestions[0]).toContain("auth setup");
    const envErr = await err(
      client({ source: "env" }).request("GET", "/project", { read: true }),
    );
    expect(envErr.message).toContain("TICKTICK_ACCESS_TOKEN");
  });

  it("fails fast when the stored token is past its expiry", async () => {
    const calls = mockFetch([]);
    const e = await err(
      client({ expiresAt: "2020-01-01T00:00:00Z" }).request("GET", "/project", {
        read: true,
      }),
    );
    expect(e.code).toBe("TOKEN_EXPIRED");
    expect(calls).toHaveLength(0);
  });

  it("maps 403 to FORBIDDEN mentioning scopes", async () => {
    mockFetch([{ url: /./, res: json({ errorMessage: "no access" }, 403) }]);
    const e = await err(client().request("GET", "/project", { read: true }));
    expect(e.code).toBe("FORBIDDEN");
    expect(e.message).toContain("no access");
    expect(e.suggestions.join(" ")).toContain("tasks:read/tasks:write");
  });

  it("maps 404 to NOT_FOUND naming the resource", async () => {
    mockFetch([{ url: /./, res: new Response("", { status: 404 }) }]);
    const e = await err(
      client().request("GET", "/project/x/task/y", {
        read: true,
        what: "task y in project x",
      }),
    );
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("Not found: task y in project x");
    const generic = await err(client().request("GET", "/x", { read: true }));
    expect(generic.message).toBe("Not found: resource");
  });

  it("maps other 4xx to API_ERROR with a short detail", async () => {
    mockFetch([{ url: /./, res: json({ message: "bad date" }, 400) }]);
    const e = await err(
      client().request("POST", "/task", { body: {}, read: false }),
    );
    expect(e.code).toBe("API_ERROR");
    expect(e.message).toBe(
      "TickTick rejected the request with HTTP 400 (bad date)",
    );
  });

  it("never echoes the token from an error body", async () => {
    mockFetch([
      {
        url: /./,
        res: json({ error_description: `bad token ${FAKE_TOKEN}` }, 400),
      },
    ]);
    const e = await err(client().request("GET", "/project", { read: true }));
    expect(e.message).not.toContain(FAKE_TOKEN);
    expect(e.message).toContain("[redacted]");
  });

  it("rejects non-JSON success bodies", async () => {
    mockFetch([{ url: /./, res: new Response("<html>", { status: 200 }) }]);
    const e = await err(client().request("GET", "/project", { read: true }));
    expect(e.code).toBe("API_ERROR");
  });
});

describe("retryAfterMs", () => {
  it("parses seconds and HTTP dates", () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs("5")).toBe(5000);
    const now = Date.parse("2026-10-09T06:30:00Z");
    expect(retryAfterMs("Fri, 09 Oct 2026 06:30:10 GMT", now)).toBe(10000);
    expect(retryAfterMs("Fri, 09 Oct 2026 06:29:00 GMT", now)).toBe(0);
    expect(retryAfterMs("soon")).toBeNull();
  });
});

describe("redact", () => {
  it("replaces each secret and ignores tiny or missing ones", () => {
    expect(redact("a secret1 b secret1", "secret1", undefined, "ab")).toBe(
      "a [redacted] b [redacted]",
    );
  });
});
