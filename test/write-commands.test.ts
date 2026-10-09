import { beforeEach, describe, expect, it } from "vitest";
import { API, isolate, json, mockFetch, PROJECT, run } from "./support.js";

const TASK_ID = "a00000000000000000000001";

const current = {
  id: TASK_ID,
  projectId: PROJECT,
  title: "Pay rent",
  dueDate: "2026-10-09T18:30:00+0000", // all-day Oct 10 IST
  isAllDay: true,
  timeZone: "Asia/Kolkata",
  priority: 1,
  status: 0,
  tags: ["home"],
  content: "old notes",
};

beforeEach(() => {
  isolate();
});

describe("create", () => {
  it("is a dry run by default and sends nothing", async () => {
    const calls = mockFetch([]);
    const { out, code } = await run(
      "create",
      "Pay rent",
      "--project",
      PROJECT,
      "--due",
      "tomorrow",
      "--priority",
      "high",
      "--tag",
      "home,bills",
      "--content",
      "notes",
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(out).toContain("dry_run: nothing was sent");
    expect(out).toContain("would_create:");
    expect(out).toContain("due: 2026-10-10 (all day)");
    expect(out).toContain("priority: high");
    expect(out).toContain(
      `create 'Pay rent' --project ${PROJECT} --due tomorrow --priority high --tag home,bills --content notes --yes`,
    );
  });

  it("creates with --yes, sending UTC dates plus the time zone", async () => {
    const calls = mockFetch([
      {
        method: "POST",
        url: /\/task$/,
        res: (c) =>
          json({ ...(c.body as object), id: "newid000000000000000001" }),
      },
    ]);
    const { out, code } = await run(
      "create",
      "Pay rent",
      "--project",
      PROJECT,
      "--due",
      "2026-10-10",
      "--start",
      "2026-10-09",
      "--priority",
      "medium",
      "--tag",
      "a",
      "--tag",
      "b",
      "--yes",
    );
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API}/task`);
    expect(calls[0].body).toEqual({
      title: "Pay rent",
      projectId: PROJECT,
      dueDate: "2026-10-09T18:30:00+0000",
      startDate: "2026-10-08T18:30:00+0000",
      isAllDay: true,
      timeZone: "Asia/Kolkata",
      priority: 3,
      tags: ["a", "b"],
    });
    expect(out).toContain("created:");
    expect(out).toContain("id: newid000000000000000001");
    expect(out).toContain("due: 2026-10-10");
    expect(out).toContain(`task ${PROJECT} newid000000000000000001`);
  });

  it("creates timed tasks from date-times", async () => {
    const calls = mockFetch([{ url: /\/task$/, res: json(null) }]);
    const { out } = await run(
      "create",
      "Call bank",
      "--project",
      PROJECT,
      "--due",
      "2026-10-12T10:30",
      "--yes",
    );
    expect(calls[0].body).toMatchObject({
      dueDate: "2026-10-12T05:00:00+0000",
      isAllDay: false,
    });
    expect(out).toContain("id: (unknown)");
    expect(out).toContain("due: none");
  });

  it("shows timed dry runs in the user's zone", async () => {
    mockFetch([]);
    const { out } = await run(
      "create",
      "Call",
      "--project",
      PROJECT,
      "--due",
      "2026-10-12T10:30",
    );
    expect(out).toContain('due: "2026-10-12 10:30 (Asia/Kolkata)"');
  });

  it("never retries a create, even when rate limited", async () => {
    const calls = mockFetch([{ url: /\/task$/, res: json({}, 429) }]);
    const { out, code } = await run(
      "create",
      "X",
      "--project",
      PROJECT,
      "--yes",
    );
    expect(code).toBe(1);
    expect(calls).toHaveLength(1);
    expect(out).toContain("code: RATE_LIMITED");
  });

  it("validates input before any call (exit 2)", async () => {
    const calls = mockFetch([]);
    const cases: Array<[string[], RegExp]> = [
      [["create", "X"], /--project is required/],
      [["create", "X", "--project", "inbox"], /no `inbox` alias/],
      [["create", "  ", "--project", PROJECT], /title cannot be empty/],
      [["create", "--project", PROJECT], /missing argument/],
      [
        [
          "create",
          "X",
          "--project",
          PROJECT,
          "--due",
          "2026-10-10",
          "--start",
          "2026-10-09T09:00",
        ],
        /both be dates/,
      ],
      [
        ["create", "X", "--project", PROJECT, "--priority", "2"],
        /not a valid priority/,
      ],
      [
        ["create", "X", "--project", PROJECT, "--confirm"],
        /unknown flag --confirm/,
      ],
      [
        ["create", "X", "--project", PROJECT, "--title", "Y"],
        /unknown flag --title/,
      ],
    ];
    for (const [argv, re] of cases) {
      const { out, code } = await run(...argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toMatch(re);
    }
    expect(calls).toHaveLength(0);
  });
});

describe("edit", () => {
  const route = (onPost?: (body: unknown) => void) => [
    { method: "GET", url: /\/task\/a0+1$/, res: json(current) },
    {
      method: "POST",
      url: new RegExp(`/task/${TASK_ID}$`),
      res: (c: { body: unknown }) => {
        onPost?.(c.body);
        return json({ ...current, ...(c.body as object) });
      },
    },
  ];

  it("previews a field-by-field diff without writing", async () => {
    const calls = mockFetch(route());
    const { out, code } = await run(
      "edit",
      PROJECT,
      TASK_ID,
      "--title",
      "Pay rent (Oct)",
      "--priority",
      "high",
      "--due",
      "2026-10-12",
      "--tag",
      "home,urgent",
      "--content",
      "new notes",
    );
    expect(code).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    expect(out).toContain("dry_run: nothing was sent");
    expect(out).toContain("changes[5]{field,from,to}:");
    expect(out).toContain("title,Pay rent,Pay rent (Oct)");
    expect(out).toContain("priority,low,high");
    expect(out).toContain('tags,home,"home, urgent"');
    expect(out).toContain("content,old notes,new notes");
    expect(out).toContain("due,2026-10-10,2026-10-12 (all day)");
    expect(out).toContain("--yes` to apply it");
  });

  it("sends only changed fields plus id/projectId with --yes", async () => {
    let sent: unknown;
    mockFetch(route((b) => (sent = b)));
    const { out, code } = await run(
      "edit",
      PROJECT,
      TASK_ID,
      "--due",
      "2026-10-12T09:00",
      "--yes",
    );
    expect(code).toBe(0);
    expect(sent).toEqual({
      id: TASK_ID,
      projectId: PROJECT,
      dueDate: "2026-10-12T03:30:00+0000",
      isAllDay: false,
      timeZone: "Asia/Kolkata",
    });
    expect(out).toContain(
      "updated:\n  id: a00000000000000000000001\n  title: Pay rent",
    );
    expect(out).toContain('due,2026-10-10,"2026-10-12 09:00"');
  });

  it("is a no-op (exit 0, no write) when nothing would change", async () => {
    const calls = mockFetch(route());
    const { out, code } = await run(
      "edit",
      PROJECT,
      TASK_ID,
      "--title",
      "Pay rent",
      "--due",
      "2026-10-10",
      "--priority",
      "low",
      "--tag",
      "home",
      "--content",
      "old notes",
      "--yes",
    );
    expect(code).toBe(0);
    expect(out).toContain("no changes (already as requested)");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("handles tasks with no fields set", async () => {
    mockFetch([{ url: /./, res: json({ id: TASK_ID, projectId: PROJECT }) }]);
    const { out } = await run(
      "edit",
      PROJECT,
      TASK_ID,
      "--tag",
      "x",
      "--content",
      "c",
      "--start",
      "today",
    );
    expect(out).toContain("tags,none,x");
    expect(out).toContain("content,none,c");
    expect(out).toContain("start,none,2026-10-09 (all day)");
  });

  it("requires something to change and validates ids", async () => {
    mockFetch([]);
    expect((await run("edit", PROJECT, TASK_ID)).out).toContain(
      "Nothing to change",
    );
    expect((await run("edit", PROJECT, "bad id", "--title", "x")).code).toBe(2);
    expect(
      (await run("edit", PROJECT, TASK_ID, "--project", "x")).out,
    ).toContain("Moving tasks between projects is not supported");
  });

  it("reports a missing task as NOT_FOUND", async () => {
    mockFetch([{ url: /./, res: new Response("", { status: 404 }) }]);
    const { out, code } = await run("edit", PROJECT, TASK_ID, "--title", "x");
    expect(code).toBe(1);
    expect(out).toContain("code: NOT_FOUND");
  });
});

describe("complete", () => {
  it("previews without writing", async () => {
    const calls = mockFetch([{ method: "GET", url: /./, res: json(current) }]);
    const { out, code } = await run("complete", PROJECT, TASK_ID);
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(out).toContain("dry_run: nothing was sent");
    expect(out).toContain('would_change: "status: open -> completed"');
    expect(out).toContain(`complete ${PROJECT} ${TASK_ID} --yes`);
  });

  it("mentions recurrence for repeating tasks", async () => {
    mockFetch([
      { url: /./, res: json({ ...current, repeatFlag: "RRULE:FREQ=WEEKLY" }) },
    ]);
    const { out } = await run("complete", PROJECT, TASK_ID);
    expect(out).toContain("repeating task (FREQ=WEEKLY)");
  });

  it("completes with --yes via the documented endpoint", async () => {
    const calls = mockFetch([
      {
        method: "GET",
        url: /./,
        res: json({ ...current, repeatFlag: "RRULE:FREQ=DAILY" }),
      },
      {
        method: "POST",
        url: /\/complete$/,
        res: new Response("", { status: 200 }),
      },
    ]);
    const { out, code } = await run("complete", PROJECT, TASK_ID, "--yes");
    expect(code).toBe(0);
    expect(calls[1].url).toBe(
      `${API}/project/${PROJECT}/task/${TASK_ID}/complete`,
    );
    expect(out).toContain(`completed:\n  id: ${TASK_ID}`);
    expect(out).toContain("next occurrence");
  });

  it("is idempotent: completing a completed task is a no-op", async () => {
    const calls = mockFetch([
      { url: /./, res: json({ ...current, status: 2 }) },
    ]);
    const { out, code } = await run("complete", PROJECT, TASK_ID, "--yes");
    expect(code).toBe(0);
    expect(out).toContain("already completed (no-op)");
    expect(calls).toHaveLength(1);
  });

  it("reports an uncertain write on network failure, without retrying", async () => {
    let posts = 0;
    mockFetch([
      { method: "GET", url: /./, res: json(current) },
      {
        method: "POST",
        url: /\/complete$/,
        res: () => {
          posts++;
          throw new TypeError("fetch failed");
        },
      },
    ]);
    const { out, code } = await run("complete", PROJECT, TASK_ID, "--yes");
    expect(code).toBe(1);
    expect(posts).toBe(1);
    expect(out).toContain("code: WRITE_UNCERTAIN");
  });

  it("rejects --execute with a targeted hint", async () => {
    const { out, code } = await run("complete", PROJECT, TASK_ID, "--execute");
    expect(code).toBe(2);
    expect(out).toContain("add --yes to apply the change");
  });
});
