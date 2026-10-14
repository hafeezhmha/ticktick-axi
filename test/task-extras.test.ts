import { beforeEach, describe, expect, it } from "vitest";
import {
  INBOX,
  isolate,
  json,
  mockFetch,
  PROJECT,
  PROJECT2,
  run,
} from "./support.js";

const T1 = "a00000000000000000000001";
const T2 = "a00000000000000000000002";

const task = (over: Record<string, unknown> = {}) => ({
  id: T1,
  projectId: PROJECT,
  title: "Pack for the trip",
  dueDate: "2026-10-09T18:30:00+0000",
  startDate: "2026-10-09T18:30:00+0000",
  isAllDay: true,
  timeZone: "Asia/Kolkata",
  status: 0,
  ...over,
});

const checklist = () =>
  task({
    items: [
      { id: "i1", title: "Charger", status: 0, sortOrder: 1 },
      { id: "i2", title: "Passport", status: 1, sortOrder: 2 },
    ],
  });

const getTask = (t: unknown) => ({
  method: "GET",
  url: /\/task\/[^/]+$/,
  res: json(t),
});

beforeEach(() => {
  isolate();
});

describe("delete", () => {
  it("previews without sending anything, and mentions the checklist", async () => {
    const calls = mockFetch([getTask(checklist())]);
    const { out, code } = await run("delete", PROJECT, T1);
    expect(code).toBe(0);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    expect(out).toContain("dry_run: nothing was sent");
    expect(out).toContain("would_delete:");
    expect(out).toContain("its checklist (2 items) goes with it");
    expect(out).toContain(`delete ${PROJECT} ${T1} --yes`);
  });

  it("deletes with --yes", async () => {
    const calls = mockFetch([
      getTask(task()),
      { method: "DELETE", url: /./, res: new Response("") },
    ]);
    const { out, code } = await run("delete", PROJECT, T1, "--yes");
    expect(code).toBe(0);
    expect(calls[1]).toMatchObject({ method: "DELETE" });
    expect(calls[1].url).toMatch(new RegExp(`/project/${PROJECT}/task/${T1}$`));
    expect(out).toContain("deleted:");
  });
});

describe("move", () => {
  const projects = {
    url: /\/project$/,
    res: json([
      { id: PROJECT, name: "Home" },
      { id: PROJECT2, name: "Work" },
    ]),
  };

  it("needs --to, and moving to the same project is a no-op", async () => {
    mockFetch([getTask(task())]);
    expect((await run("move", PROJECT, T1)).out).toContain(
      "--to <projectId> is required",
    );
    const same = await run("move", PROJECT, T1, "--to", PROJECT);
    expect(same.code).toBe(0);
    expect(same.out).toContain("already in that project (no-op)");
    expect((await run("move", PROJECT, T1, "--to", "inbox")).out).toContain(
      "real id",
    );
  });

  it("previews with project names, then moves with --yes", async () => {
    let calls = mockFetch([getTask(task()), projects]);
    const dry = await run("move", PROJECT, T1, "--to", INBOX);
    expect(dry.out).toContain('would_change: "project: Home -> Inbox"');
    expect(calls.some((c) => c.url.endsWith("/task/move"))).toBe(false);

    calls = mockFetch([
      getTask(task()),
      projects,
      {
        method: "POST",
        url: /\/task\/move$/,
        res: json([{ id: T1, etag: "e" }]),
      },
    ]);
    const done = await run("move", PROJECT, T1, "--to", PROJECT2, "--yes");
    expect(done.code).toBe(0);
    expect(done.out).toContain("moved:");
    expect(calls.at(-1)?.body).toEqual([
      { fromProjectId: PROJECT, toProjectId: PROJECT2, taskId: T1 },
    ]);
  });

  it("reports WRITE_UNCERTAIN when TickTick does not confirm", async () => {
    mockFetch([
      getTask(task()),
      projects,
      { method: "POST", url: /\/task\/move$/, res: json([]) },
    ]);
    const { out, code } = await run(
      "move",
      PROJECT,
      T1,
      "--to",
      PROJECT2,
      "--yes",
    );
    expect(code).toBe(1);
    expect(out).toContain("code: WRITE_UNCERTAIN");
  });
});

describe("complete several", () => {
  const two = [
    getTask(task()),
    {
      method: "GET",
      url: new RegExp(`/task/${T2}$`),
      res: json(task({ id: T2, title: "Done already", status: 2 })),
    },
  ];

  it("previews each task and skips completed ones", async () => {
    mockFetch([two[1], getTask(task())]);
    const { out, code } = await run("complete", PROJECT, T1, T2);
    expect(code).toBe(0);
    expect(out).toContain("dry_run: nothing was sent");
    expect(out).toContain("already completed (skipped)");
    expect(out).toContain("complete 1 task(s)");
  });

  it("sends only the open ones and reports what TickTick completed", async () => {
    const calls = mockFetch([
      two[1],
      getTask(task()),
      { method: "POST", url: /\/completeTasks$/, res: json([T1]) },
    ]);
    const { out, code } = await run("complete", PROJECT, T1, T2, "--yes");
    expect(code).toBe(0);
    expect(calls.at(-1)?.body).toEqual({ projectId: PROJECT, taskIds: [T1] });
    expect(out).toContain("completed: 1 of 1");
  });

  it("caps at 50 tasks", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `t${i}`);
    const { out, code } = await run("complete", PROJECT, ...ids);
    expect(code).toBe(2);
    expect(out).toContain("At most 50 tasks at once");
  });
});

describe("edit --clear-due / --clear-start", () => {
  it("sends null, which is how TickTick clears a date", async () => {
    const calls = mockFetch([
      getTask(task()),
      {
        method: "POST",
        url: /\/task\//,
        res: json(task({ dueDate: undefined })),
      },
    ]);
    const dry = await run("edit", PROJECT, T1, "--clear-due");
    expect(dry.out).toContain("dry_run: nothing was sent");
    expect(dry.out).toMatch(/due,[^\n]*,none/);
    const { code } = await run(
      "edit",
      PROJECT,
      T1,
      "--clear-due",
      "--clear-start",
      "--yes",
    );
    expect(code).toBe(0);
    expect(calls.at(-1)?.body).toMatchObject({
      dueDate: null,
      startDate: null,
    });
  });

  it("is a no-op without a date, and cannot be combined with --due", async () => {
    mockFetch([getTask(task({ dueDate: undefined, startDate: undefined }))]);
    expect((await run("edit", PROJECT, T1, "--clear-due")).out).toContain(
      "no changes",
    );
    const both = await run(
      "edit",
      PROJECT,
      T1,
      "--clear-due",
      "--due",
      "today",
    );
    expect(both.code).toBe(2);
  });
});

describe("item", () => {
  const update = {
    method: "POST",
    url: /\/task\//,
    res: (c: { body: unknown }) =>
      json({ ...checklist(), ...(c.body as object) }),
  };

  it("adds to the end and sends the whole list back intact", async () => {
    const calls = mockFetch([getTask(checklist()), update]);
    const dry = await run("item", "add", PROJECT, T1, "Snacks");
    expect(dry.out).toContain("add item 3: Snacks");
    expect(dry.out).toContain("1/3 done");
    await run("item", "add", PROJECT, T1, "Snacks", "--yes");
    expect((calls.at(-1)?.body as { items: unknown[] }).items).toEqual([
      { id: "i1", title: "Charger", status: 0, sortOrder: 1 },
      { id: "i2", title: "Passport", status: 1, sortOrder: 2 },
      { title: "Snacks", status: 0 },
    ]);
  });

  it("ticks, unticks, renames and removes by number or id", async () => {
    const calls = mockFetch([getTask(checklist()), update]);
    await run("item", "done", PROJECT, T1, "1", "--yes");
    expect(
      (calls.at(-1)?.body as { items: Array<{ status: number }> }).items[0]
        .status,
    ).toBe(1);
    await run("item", "undo", PROJECT, T1, "i2", "--yes");
    expect(
      (calls.at(-1)?.body as { items: Array<{ status: number }> }).items[1]
        .status,
    ).toBe(0);
    await run("item", "rename", PROJECT, T1, "2", "Passport + visa", "--yes");
    expect(
      (calls.at(-1)?.body as { items: Array<{ title: string }> }).items[1]
        .title,
    ).toBe("Passport + visa");
    await run("item", "remove", PROJECT, T1, "1", "--yes");
    expect(
      (calls.at(-1)?.body as { items: Array<{ id: string }> }).items.map(
        (i) => i.id,
      ),
    ).toEqual(["i2"]);
  });

  it("no-ops, bad references and tasks without a checklist", async () => {
    mockFetch([getTask(checklist())]);
    expect((await run("item", "done", PROJECT, T1, "2")).out).toContain(
      "already done (no-op)",
    );
    expect((await run("item", "done", PROJECT, T1, "9")).out).toContain(
      "There is no item 9",
    );
    expect((await run("item", "done", PROJECT, T1, "nope")).out).toContain(
      "code: NOT_FOUND",
    );
    expect((await run("item", "frob", PROJECT, T1)).code).toBe(2);
    mockFetch([getTask(task())]);
    expect((await run("item", "done", PROJECT, T1, "1")).out).toContain(
      "no checklist items",
    );
  });
});

describe("search", () => {
  it("sends keywords and filters, with day bounds in the user's zone", async () => {
    const calls = mockFetch([
      { method: "POST", url: /\/task\/search$/, res: json([task()]) },
    ]);
    const { out, code } = await run(
      "search",
      "pack",
      "--project",
      PROJECT,
      "--tag",
      "travel",
      "--status",
      "open",
      "--due-from",
      "2026-10-01",
      "--due-to",
      "2026-10-31",
    );
    expect(code).toBe(0);
    expect(calls[0].body).toEqual({
      keywords: "pack",
      projectIds: [PROJECT],
      tags: ["travel"],
      status: [0],
      dueFrom: "2026-09-30T18:30:00+0000",
      dueTo: "2026-10-31T18:29:59+0000",
    });
    expect(out).toContain('count: "1 of 1 tasks matching \\"pack\\""');
  });

  it("rejects blank keywords and says when nothing matched", async () => {
    mockFetch([{ method: "POST", url: /\/task\/search$/, res: json([]) }]);
    expect((await run("search", "  ")).code).toBe(2);
    expect((await run("search", "zzz")).out).toContain("0 tasks matching");
  });
});

describe("search --limit hint", () => {
  it("gives the full command to see everything", async () => {
    const many = Array.from({ length: 3 }, (_, i) => task({ id: `s${i}` }));
    mockFetch([{ method: "POST", url: /\/task\/search$/, res: json(many) }]);
    const { out } = await run("search", "pack", "--limit", "1", "--tag", "x");
    expect(out).toContain(
      "Run `ticktick-axi search pack --tag x --limit 3` to see all 3",
    );
  });
});

describe("completed", () => {
  it("defaults to the last 7 days and lists newest first", async () => {
    const calls = mockFetch([
      {
        method: "POST",
        url: /\/task\/completed$/,
        res: json([
          task({
            id: "old",
            status: 2,
            completedTime: "2026-10-03T05:00:00+0000",
          }),
          task({
            id: "new",
            status: 2,
            completedTime: "2026-10-08T05:00:00+0000",
          }),
        ]),
      },
    ]);
    const { out, code } = await run("completed");
    expect(code).toBe(0);
    expect(calls[0].body).toEqual({ startDate: "2026-10-01T18:30:00+0000" });
    expect(out.indexOf("new,")).toBeLessThan(out.indexOf("old,"));
    expect(out).toContain("in the last 7 days");
  });

  it("notes the 200 cap", async () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      task({ id: `c${i}`, status: 2 }),
    );
    mockFetch([{ method: "POST", url: /\/task\/completed$/, res: json(many) }]);
    expect((await run("completed", "--from", "-30d")).out).toContain(
      "at most 200",
    );
  });
});

describe("comments", () => {
  const comments = {
    method: "GET",
    url: /\/comments$/,
    res: json([
      { id: "c2", title: "Second", createdTime: "2026-10-08T05:00:00+0000" },
      { id: "c1", title: "First", createdTime: "2026-10-07T05:00:00+0000" },
    ]),
  };

  it("lists oldest first, and says when there are none", async () => {
    mockFetch([comments]);
    const { out } = await run("comments", PROJECT, T1);
    expect(out.indexOf("First")).toBeLessThan(out.indexOf("Second"));
    mockFetch([{ method: "GET", url: /\/comments$/, res: json([]) }]);
    expect((await run("comments", PROJECT, T1)).out).toContain("0 comments");
  });

  it("reads times sent as epoch milliseconds, as the live API does", async () => {
    mockFetch([
      {
        method: "GET",
        url: /\/comments$/,
        res: json([
          { id: "c2", title: "Later", createdTime: 1791963023935 },
          { id: "c1", title: "Earlier", createdTime: 1791900000000 },
        ]),
      },
    ]);
    const { out, code } = await run("comments", PROJECT, T1);
    expect(code).toBe(0);
    expect(out.indexOf("Earlier")).toBeLessThan(out.indexOf("Later"));
    expect(out).toMatch(/c1,"2026-10-13 /);
  });

  it("adds after a preview", async () => {
    const calls = mockFetch([
      getTask(task()),
      {
        method: "POST",
        url: /\/comment$/,
        res: json({ id: "c9", title: "Called" }),
      },
    ]);
    expect((await run("comment", "add", PROJECT, T1, "Called")).out).toContain(
      "would_add: Called",
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const { out } = await run("comment", "add", PROJECT, T1, "Called", "--yes");
    expect(out).toContain("added:");
    expect(calls.at(-1)?.body).toEqual({ title: "Called" });
  });

  it("deletes an existing comment; an unknown one is a no-op", async () => {
    const calls = mockFetch([
      comments,
      { method: "DELETE", url: /./, res: new Response("") },
    ]);
    const gone = await run("comment", "delete", PROJECT, T1, "nope");
    expect(gone.code).toBe(0);
    expect(gone.out).toContain("already deleted, or the id is wrong (no-op)");
    expect((await run("comment", "delete", PROJECT, T1, "c1")).out).toContain(
      "would_delete:",
    );
    await run("comment", "delete", PROJECT, T1, "c1", "--yes");
    expect(calls.at(-1)?.url).toMatch(/\/comment\/c1$/);
    expect((await run("comment")).code).toBe(2);
  });
});
