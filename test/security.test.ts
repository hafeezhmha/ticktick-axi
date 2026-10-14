import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeStoredToken } from "../src/config.js";
import {
  FAKE_SECRET,
  FAKE_TOKEN,
  fixtureTasks,
  isolate,
  json,
  mockFetch,
  PROJECT,
  run,
} from "./support.js";

const TASK = "a00000000000000000000001";
const HABIT = "b00000000000000000000001";
const FOCUS = "d00000000000000000000001";
const habit = { id: HABIT, name: "Read", goal: 1, status: 0 };
const focus = {
  id: FOCUS,
  type: 0,
  startTime: "2026-10-08T03:30:00+0000",
  endTime: "2026-10-08T03:55:00+0000",
};

/** Every command an agent can run, reads and confirmed writes alike. */
const COMMANDS: string[][] = [
  [],
  ["projects"],
  ["tasks"],
  ["tasks", "--project", PROJECT],
  ["overdue"],
  ["upcoming"],
  ["task", PROJECT, TASK],
  ["create", "X", "--project", PROJECT, "--yes"],
  ["edit", PROJECT, TASK, "--title", "Y", "--yes"],
  ["complete", PROJECT, TASK, "--yes"],
  ["auth", "status", "--verify"],
  ["auth", "setup"],
  ["search", "rent"],
  ["completed"],
  ["comments", PROJECT, TASK],
  ["comment", "add", PROJECT, TASK, "note", "--yes"],
  ["move", PROJECT, TASK, "--to", "6226ff9877acee87727f6bcb", "--yes"],
  ["delete", PROJECT, TASK, "--yes"],
  ["complete", PROJECT, TASK, "a00000000000000000000002", "--yes"],
  ["item", "add", PROJECT, TASK, "x", "--yes"],
  ["edit", PROJECT, TASK, "--clear-due", "--yes"],
  ["habits"],
  ["habit", "show", HABIT],
  ["habit", "sections"],
  ["habit", "checkins"],
  ["habit", "checkin", HABIT, "--yes"],
  ["habit", "create", "Z", "--yes"],
  ["habit", "edit", HABIT, "--name", "Q", "--yes"],
  ["focus"],
  ["focus", "show", FOCUS],
  ["focus", "log", "--minutes", "5", "--yes"],
  ["focus", "delete", FOCUS, "--yes"],
  ["countdowns"],
  ["preferences"],
  ["auth", "logout"],
];

beforeEach(() => {
  isolate();
  vi.stubEnv("TICKTICK_CLIENT_ID", "test-client-id");
  vi.stubEnv("TICKTICK_CLIENT_SECRET", FAKE_SECRET);
});

describe("tokens never reach output", () => {
  it("on success paths", async () => {
    mockFetch([
      { url: /\/project$/, res: json([{ id: PROJECT, name: "Work" }]) },
      { method: "GET", url: /\/habit\/checkins\?/, res: json([]) },
      { method: "GET", url: /\/habit\/sections$/, res: json([]) },
      { method: "GET", url: /\/habit$/, res: json([habit]) },
      { url: /\/habit\//, res: json(habit) },
      { method: "POST", url: /\/habit$/, res: json(habit) },
      { method: "GET", url: /\/focus\?/, res: json([focus]) },
      { method: "GET", url: /\/focus\//, res: json(focus) },
      { method: "POST", url: /\/focus$/, res: json(focus) },
      { url: /\/countdown$/, res: json([{ id: "e1", date: 20261101 }]) },
      { url: /\/preference$/, res: json({ timeZone: "Asia/Kolkata" }) },
      { url: /\/data$/, res: json({ tasks: fixtureTasks() }) },
      { url: /\/task\/filter$/, res: json(fixtureTasks()) },
      { method: "GET", url: /\/task\//, res: json(fixtureTasks()[0]) },
      { method: "POST", url: /\/complete$/, res: new Response("") },
      { method: "POST", url: /\/task(\/|$)/, res: json(fixtureTasks()[0]) },
      { method: "DELETE", url: /./, res: new Response("") },
    ]);
    for (const argv of COMMANDS) {
      const { out } = await run(...argv);
      expect(out, argv.join(" ")).not.toContain(FAKE_TOKEN);
      expect(out, argv.join(" ")).not.toContain(FAKE_SECRET);
    }
  });

  it.each([400, 401, 403, 404, 429, 500])(
    "when the API echoes the token in a %i error body",
    async (status) => {
      mockFetch([
        {
          url: /./,
          res: json(
            {
              errorMessage: `token ${FAKE_TOKEN} rejected`,
              message: FAKE_TOKEN,
              error_description: `Bearer ${FAKE_TOKEN}`,
            },
            status,
          ),
        },
      ]);
      for (const argv of COMMANDS) {
        const { out } = await run(...argv);
        expect(out, `${status} ${argv.join(" ")}`).not.toContain(FAKE_TOKEN);
      }
    },
  );

  it("for a stored token, in status and logout", async () => {
    vi.stubEnv("TICKTICK_ACCESS_TOKEN", "");
    writeStoredToken({
      accessToken: FAKE_TOKEN,
      kind: "oauth",
      obtainedAt: "x",
    });
    for (const argv of [["auth", "status"], ["auth"], ["auth", "logout"]]) {
      expect((await run(...argv)).out).not.toContain(FAKE_TOKEN);
    }
  });

  it("does not send the token anywhere but the API host", async () => {
    const calls = mockFetch([{ url: /./, res: json(fixtureTasks()) }]);
    await run("tasks");
    for (const c of calls) {
      expect(new URL(c.url).host).toBe("api.ticktick.com");
      expect(c.url).not.toContain(FAKE_TOKEN);
    }
  });
});
