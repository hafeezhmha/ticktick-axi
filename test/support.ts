import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { main } from "../src/cli.js";
import { timing } from "../src/http.js";

/** Obviously fake; any appearance in output is a leak. */
export const FAKE_TOKEN = "test-token-not-real";
export const FAKE_SECRET = "test-secret-not-real";
export const FAKE_CLIENT_ID = "test-client-id";

/** Thursday 2026-10-09 12:00 in Asia/Kolkata (06:30 UTC). */
export const NOW = Date.parse("2026-10-09T06:30:00Z");
export const TZ = "Asia/Kolkata";

export const API = "https://api.ticktick.com/open/v1";

/**
 * Isolate a test: temp config dir, fixed clock and zone, no real
 * credentials from the developer's environment, and instant retries.
 */
export function isolate(opts: { token?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ticktick-axi-test-"));
  vi.stubEnv("TICKTICK_AXI_CONFIG_DIR", dir);
  vi.stubEnv("TICKTICK_AXI_TZ", TZ);
  vi.stubEnv("TICKTICK_AXI_API_BASE", "");
  vi.stubEnv("TICKTICK_AXI_AUTH_BASE", "");
  vi.stubEnv("TICKTICK_CLIENT_ID", "");
  vi.stubEnv("TICKTICK_CLIENT_SECRET", "");
  vi.stubEnv("TICKTICK_REDIRECT_URI", "");
  vi.stubEnv("TICKTICK_ACCESS_TOKEN", opts.token === false ? "" : FAKE_TOKEN);
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  timing.sleep = vi.fn(async () => {});
  return dir;
}

export interface Call {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

type Responder = Response | ((call: Call) => Response | Promise<Response>);

export interface Route {
  method?: string;
  url: RegExp;
  res: Responder;
}

export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(data === undefined ? "" : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Stub global fetch with a router; unmatched calls throw loudly. */
export function mockFetch(routes: Route[]) {
  const calls: Call[] = [];
  const fn = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      let body: unknown = init?.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          /* form-encoded bodies stay strings */
        }
      }
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      );
      const call = { method, url, body, headers };
      calls.push(call);
      for (const r of routes) {
        if ((!r.method || r.method === method) && r.url.test(url)) {
          return typeof r.res === "function" ? r.res(call) : r.res.clone();
        }
      }
      throw new Error(`unmocked fetch: ${method} ${url}`);
    },
  );
  vi.stubGlobal("fetch", fn);
  return calls;
}

/** Run the CLI in-process; returns stdout text and the exit code. */
export async function run(...argv: string[]) {
  let out = "";
  process.exitCode = undefined;
  await main({ argv, stdout: { write: (s: string) => (out += s) } });
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return { out, code };
}

export const PROJECT = "6226ff9877acee87727f6bca";
export const PROJECT2 = "6226ff9877acee87727f6bcb";
export const INBOX = "inbox1234567";

/** A spread of tasks relative to NOW (2026-10-09 12:00 IST). */
export function fixtureTasks() {
  return [
    {
      id: "a00000000000000000000001",
      projectId: PROJECT,
      title: "Pay electricity bill",
      dueDate: "2026-10-07T18:30:00+0000", // all-day Oct 8 IST: overdue
      isAllDay: true,
      timeZone: TZ,
      priority: 5,
      status: 0,
      tags: ["home"],
    },
    {
      id: "a00000000000000000000002",
      projectId: PROJECT,
      title: "Team sync",
      dueDate: "2026-10-09T10:30:00.000+0000", // 16:00 IST today
      isAllDay: false,
      priority: 3,
      status: 0,
    },
    {
      id: "a00000000000000000000003",
      projectId: PROJECT2,
      title: "Morning pages",
      dueDate: "2026-10-09T03:30:00+0000", // 09:00 IST today: passed
      isAllDay: false,
      priority: 0,
      status: 0,
    },
    {
      id: "a00000000000000000000004",
      projectId: PROJECT2,
      title: "Renew passport",
      dueDate: "2026-10-11T18:30:00+0000", // all-day Oct 12
      isAllDay: true,
      timeZone: TZ,
      priority: 1,
      status: 0,
      tags: ["admin", "home"],
    },
    {
      id: "a00000000000000000000005",
      projectId: INBOX,
      title: "Someday idea",
      status: 0,
    },
    {
      id: "a00000000000000000000006",
      projectId: PROJECT,
      title: "Book flights",
      dueDate: "2026-11-30T18:30:00+0000", // all-day Dec 1
      isAllDay: true,
      timeZone: TZ,
      priority: 3,
      status: 0,
    },
  ];
}
