import { beforeEach, describe, expect, it } from "vitest";
import {
  API,
  fixtureTasks,
  INBOX,
  isolate,
  json,
  mockFetch,
  PROJECT,
  PROJECT2,
  run,
} from "./support.js";

const filterRoute = (tasks: unknown[]) => ({
  method: "POST",
  url: /\/task\/filter$/,
  res: json(tasks),
});

beforeEach(() => {
  isolate();
});

describe("home (no args)", () => {
  it("shows setup steps when not signed in, without calling the API", async () => {
    isolate({ token: false });
    const calls = mockFetch([]);
    const { out, code } = await run();
    expect(code).toBe(0);
    expect(out).toContain("bin: ");
    expect(out).toContain("status: not signed in to TickTick");
    expect(out).toContain("npx -y ticktick-axi auth setup");
    expect(out).toContain("auth login --no-wait");
    expect(calls).toHaveLength(0);
  });

  it("summarises overdue, today and the week ahead", async () => {
    const calls = mockFetch([filterRoute(fixtureTasks())]);
    const { out, code } = await run();
    expect(code).toBe(0);
    expect(out).toContain("description: Agent ergonomic CLI for TickTick");
    expect(out).toContain("today: 2026-10-09 (Asia/Kolkata)");
    expect(out).toMatch(
      /open: 6\n\s+overdue: 2\n\s+due_today: 1\n\s+next_7_days: 1\n\s+no_due_date: 1/,
    );
    expect(out).toContain("overdue[2]{id,projectId,title,due}:");
    expect(out).toContain("Pay electricity bill,2026-10-08");
    expect(out).toContain('Morning pages,"2026-10-09 09:00"');
    expect(out).toContain("due_today[1]{id,projectId,title,due}:");
    expect(out).toContain('Team sync,"2026-10-09 16:00"');
    expect(out).toContain("help[");
    expect(calls[0].body).toEqual({ status: [0] });
  });

  it("states an empty account definitively", async () => {
    mockFetch([filterRoute([])]);
    const { out } = await run();
    expect(out).toContain('tasks: "0 open tasks: nothing to do"');
  });

  it("says none for empty sections and links to the full overdue list", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `b0000000000000000000000${i}`,
      projectId: PROJECT,
      title: `Late ${i}`,
      dueDate: "2026-10-01T18:30:00+0000",
      isAllDay: true,
      status: 0,
    }));
    mockFetch([filterRoute(many)]);
    const { out } = await run();
    expect(out).toContain("due_today: none");
    expect(out).toContain("overdue[5]");
    expect(out).toContain("Run `ticktick-axi overdue` to see all 7 overdue");
  });

  it("notes the 200-task cap", async () => {
    const capped = Array.from({ length: 200 }, (_, i) => ({
      id: `c${String(i).padStart(23, "0")}`,
      projectId: PROJECT,
      title: `T${i}`,
      status: 0,
    }));
    mockFetch([filterRoute(capped)]);
    const { out } = await run();
    expect(out).toContain(
      "note: TickTick's filter endpoint returns at most 200 tasks",
    );
  });

  it("reports API errors as structured output with exit 1", async () => {
    mockFetch([{ url: /./, res: json({}, 401) }]);
    const { out, code } = await run();
    expect(code).toBe(1);
    expect(out).toContain("code: TOKEN_EXPIRED");
  });
});

describe("projects", () => {
  const projects = [
    { id: PROJECT, name: "Work", kind: "TASK", closed: false },
    { id: PROJECT2, name: "Home, garden", kind: "TASK" },
    { id: "6226ff9877acee87727f6bcc", name: "Old", kind: "NOTE", closed: true },
  ];

  it("lists open projects with totals and an Inbox hint", async () => {
    mockFetch([{ url: /\/project$/, res: json(projects) }]);
    const { out, code } = await run("projects");
    expect(code).toBe(0);
    expect(out).toContain("count: 2 of 3 total");
    expect(out).toContain("projects[2]{id,name,kind}:");
    expect(out).toContain(`${PROJECT},Work,task`);
    expect(out).toContain(`${PROJECT2},"Home, garden",task`);
    expect(out).toContain("--project inbox");
    expect(out).toContain("projects --closed` to include 1 closed");
  });

  it("includes closed projects with --closed", async () => {
    mockFetch([{ url: /\/project$/, res: json(projects) }]);
    const { out } = await run("projects", "--closed");
    expect(out).toContain("projects[3]{id,name,kind,closed}:");
    expect(out).toContain("Old,note,true");
  });

  it("has a definitive empty state", async () => {
    mockFetch([{ url: /\/project$/, res: json([projects[2]]) }]);
    expect((await run("projects")).out).toContain(
      "projects: 0 open projects found (1 closed hidden)",
    );
    mockFetch([{ url: /\/project$/, res: json([]) }]);
    expect((await run("projects", "--closed")).out).toContain(
      "projects: 0 projects found",
    );
  });

  it("rejects stray arguments", async () => {
    const { code, out } = await run("projects", "Work");
    expect(code).toBe(2);
    expect(out).toContain('unexpected argument \\"Work\\"');
  });
});

describe("tasks", () => {
  it("lists open tasks across projects, soonest due first", async () => {
    const calls = mockFetch([filterRoute(fixtureTasks())]);
    const { out, code } = await run("tasks");
    expect(code).toBe(0);
    expect(out).toContain("count: 6 of 6 open tasks");
    expect(out).toContain("tasks[6]{id,projectId,title,due}:");
    const order = [
      "Pay electricity bill",
      "Morning pages",
      "Team sync",
      "Renew passport",
      "Book flights",
      "Someday idea",
    ];
    const positions = order.map((t) => out.indexOf(t));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(calls[0].body).toEqual({ status: [0] });
  });

  it("uses the complete project data endpoint for one project's open tasks", async () => {
    const calls = mockFetch([
      {
        url: new RegExp(`/project/${PROJECT}/data$`),
        res: json({
          project: { id: PROJECT },
          tasks: fixtureTasks().filter((t) => t.projectId === PROJECT),
        }),
      },
    ]);
    const { out } = await run(
      "tasks",
      "--project",
      PROJECT,
      "--priority",
      "high,medium",
      "--tag",
      "home",
    );
    expect(calls[0].url).toBe(`${API}/project/${PROJECT}/data`);
    expect(out).toContain("tasks[1]{id,title,due,priority}:");
    expect(out).toContain("Pay electricity bill,2026-10-08,high");
    expect(out).toContain(`task ${PROJECT} <taskId>`);
  });

  it("handles project data without tasks", async () => {
    mockFetch([{ url: /\/data$/, res: json({ project: { id: PROJECT } }) }]);
    const { out } = await run("tasks", "--project", PROJECT);
    expect(out).toContain(`tasks: 0 open tasks in project ${PROJECT} found`);
    expect(out).toContain(`create \\"<title>\\" --project ${PROJECT}`);
  });

  it("sends status, priority, tag and project filters to /task/filter", async () => {
    const calls = mockFetch([filterRoute([])]);
    await run(
      "tasks",
      "--status",
      "completed",
      "--project",
      PROJECT,
      "--priority",
      "low",
      "--tag",
      "a,b",
    );
    expect(calls[0].body).toEqual({
      status: [2],
      projectIds: [PROJECT],
      priority: [1],
      tag: ["a", "b"],
    });
  });

  it("filters the Inbox client-side from documented endpoints", async () => {
    const calls = mockFetch([filterRoute(fixtureTasks())]);
    const { out } = await run("tasks", "--project", "inbox");
    expect(calls[0].body).toEqual({ status: [0] });
    expect(out).toContain("tasks[1]{id,projectId,title,due}:");
    expect(out).toContain(`${INBOX},Someday idea`);
  });

  it("applies due-before / due-after locally", async () => {
    mockFetch([filterRoute(fixtureTasks())]);
    const { out } = await run(
      "tasks",
      "--due-after",
      "today",
      "--due-before",
      "2026-12-01",
    );
    expect(out).toContain("tasks[1]");
    expect(out).toContain("Renew passport");
  });

  it("supports --overdue and --upcoming", async () => {
    mockFetch([filterRoute(fixtureTasks())]);
    const over = await run("tasks", "--overdue");
    expect(over.out).toContain("count: 2 of 2 overdue open tasks");
    const up = await run("tasks", "--upcoming", "3");
    expect(up.out).toContain("tasks[2]");
    expect(up.out).toContain("Team sync");
    expect(up.out).toContain("Renew passport");
  });

  it("truncates to --limit and tells how to see the rest", async () => {
    mockFetch([filterRoute(fixtureTasks())]);
    const { out } = await run("tasks", "--limit", "2", "--tag", "x y");
    expect(out).toContain("count: 2 of 6");
    expect(out).toContain(
      "Run `ticktick-axi tasks --tag 'x y' --limit 6` to see all 6",
    );
    const eq = await run("tasks", "--limit=1");
    expect(eq.out).toContain("Run `ticktick-axi tasks --limit 6` to see all 6");
  });

  it("adds --fields columns", async () => {
    mockFetch([filterRoute(fixtureTasks())]);
    const { out } = await run(
      "tasks",
      "--fields",
      "priority,tags",
      "--limit",
      "1",
    );
    expect(out).toContain("tasks[1]{id,projectId,title,due,priority,tags}:");
    expect(out).toContain("Pay electricity bill,2026-10-08,high,home");
  });

  it("has a definitive empty state that suggests next steps", async () => {
    mockFetch([filterRoute([])]);
    const { out, code } = await run(
      "tasks",
      "--overdue",
      "--tag",
      "work",
      "--priority",
      "high",
      "--due-before",
      "+7d",
      "--due-after",
      "-7d",
    );
    expect(code).toBe(0);
    expect(out).toContain(
      "tasks: 0 overdue open tasks due before the given date due after the given date with the given priority tagged work found",
    );
    expect(out).toContain("Run `ticktick-axi tasks` to list all open tasks");
  });

  it("describes status all and upcoming windows", async () => {
    mockFetch([filterRoute([])]);
    expect((await run("tasks", "--status", "all")).out).toContain(
      "tasks: 0 tasks found",
    );
    expect(
      (await run("tasks", "--upcoming", "5", "--project", "inbox")).out,
    ).toContain("0 open tasks due in the next 5 days in the Inbox found");
  });

  it("validates flags before any API call (exit 2)", async () => {
    const calls = mockFetch([]);
    const cases: Array<[string[], RegExp]> = [
      [["tasks", "--stat", "open"], /unknown flag --stat/],
      [["tasks", "--state", "open"], /unknown flag --state/],
      [["tasks", "--status", "done"], /--status/],
      [["tasks", "--overdue", "--upcoming", "3"], /cannot be combined/],
      [
        ["tasks", "--overdue", "--status", "completed"],
        /only apply to --status open/,
      ],
      [["tasks", "--due-before", "someday"], /not a valid date/],
      [["tasks", "--priority", "urgent"], /not a valid priority/],
      [["tasks", "--limit", "0"], /between 1 and 500/],
      [["tasks", "--fields", "nope"], /unknown field/],
      [["tasks", "--project", "../etc"], /invalid project id/],
      [["tasks", "extra"], /unexpected argument/],
      [["overdue", "extra"], /unexpected argument/],
    ];
    for (const [argv, re] of cases) {
      const { out, code } = await run(...argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toMatch(re);
      expect(out).toContain("code: VALIDATION_ERROR");
    }
    expect(calls).toHaveLength(0);
  });

  it("fails with AUTH_REQUIRED (exit 1) when not signed in", async () => {
    isolate({ token: false });
    const { out, code } = await run("tasks");
    expect(code).toBe(1);
    expect(out).toContain("code: AUTH_REQUIRED");
    expect(out).toContain("auth login");
  });
});

describe("overdue / upcoming", () => {
  it("overdue lists only overdue open tasks", async () => {
    mockFetch([filterRoute(fixtureTasks())]);
    const { out } = await run("overdue", "--fields", "priority");
    expect(out).toContain("tasks[2]{id,projectId,title,due,priority}:");
    expect(out).not.toContain("Team sync");
  });

  it("overdue has an explicit empty state", async () => {
    mockFetch([filterRoute([])]);
    const { out } = await run("overdue");
    expect(out).toContain("overdue: 0 overdue open tasks found");
  });

  it("upcoming defaults to 7 days and honours --days", async () => {
    mockFetch([filterRoute(fixtureTasks())]);
    const week = await run("upcoming");
    expect(week.out).toContain("tasks[2]");
    const long = await run("upcoming", "--days", "60");
    expect(long.out).toContain("tasks[3]");
    expect(long.out).toContain("Book flights");
    mockFetch([{ url: /\/data$/, res: json({ tasks: fixtureTasks() }) }]);
    const none = await run("upcoming", "--days", "0", "--project", PROJECT2);
    expect(none.code).toBe(0);
    expect(none.out).toContain("Team sync");
  });

  it("upcoming validates --days", async () => {
    const { code, out } = await run("upcoming", "--days", "x");
    expect(code).toBe(2);
    expect(out).toContain("--days must be a whole number");
  });
});

describe("task", () => {
  const detail = {
    id: "a00000000000000000000001",
    projectId: PROJECT,
    title: "Pay electricity bill",
    content: "x".repeat(1500),
    desc: "checklist notes",
    dueDate: "2026-10-07T18:30:00+0000",
    startDate: "2026-10-06T18:30:00+0000",
    isAllDay: true,
    timeZone: "Asia/Kolkata",
    repeatFlag: "RRULE:FREQ=MONTHLY;INTERVAL=1",
    priority: 5,
    status: 0,
    tags: ["home", "bills"],
    kind: "CHECKLIST",
    parentId: "a00000000000000000000009",
    items: Array.from({ length: 25 }, (_, i) => ({
      title: `step ${i}`,
      status: i < 3 ? 1 : 0,
    })),
  };

  it("shows details with truncation hints", async () => {
    const calls = mockFetch([
      { url: /\/project\/.+\/task\/.+$/, res: json(detail) },
    ]);
    const { out, code } = await run("task", PROJECT, detail.id);
    expect(code).toBe(0);
    expect(calls[0].url).toBe(`${API}/project/${PROJECT}/task/${detail.id}`);
    expect(out).toContain("title: Pay electricity bill");
    expect(out).toContain("priority: high");
    expect(out).toContain("due: 2026-10-08 (all day)");
    expect(out).toContain("overdue: true");
    expect(out).toContain("start: 2026-10-07");
    expect(out).toContain('tags: "home, bills"');
    expect(out).toContain("repeat: FREQ=MONTHLY;INTERVAL=1");
    expect(out).toContain("(truncated, 1500 chars total)");
    expect(out).toContain("checklist: 3/25 done");
    expect(out).toContain("items[20]{n,id,title,done}:");
    expect(out).toContain(`task ${PROJECT} ${detail.id} --full`);
    expect(out).toContain(`complete ${PROJECT} ${detail.id}`);
  });

  it("--full shows everything", async () => {
    mockFetch([{ url: /./, res: json(detail) }]);
    const { out } = await run("task", PROJECT, detail.id, "--full");
    expect(out).not.toContain("truncated");
    expect(out).toContain("items[25]{n,id,title,done}:");
    expect(out).not.toContain("--full`");
  });

  it("shows completed tasks without action hints", async () => {
    mockFetch([
      {
        url: /./,
        res: json({
          id: "t1",
          projectId: PROJECT,
          title: "Done thing",
          status: 2,
          dueDate: "2026-10-09T10:30:00+0000",
          completedTime: "2026-10-09T05:00:00+0000",
        }),
      },
    ]);
    const { out } = await run("task", PROJECT, "t1");
    expect(out).toContain("status: completed");
    expect(out).toContain('due: "2026-10-09 16:00 (Asia/Kolkata)"');
    expect(out).toContain('completed: "2026-10-09 10:30"');
    expect(out).not.toContain("help");
  });

  it("shows a task with no due date", async () => {
    mockFetch([
      { url: /./, res: json({ id: "t1", projectId: PROJECT, status: 0 }) },
    ]);
    const { out } = await run("task", PROJECT, "t1");
    expect(out).toContain("due: none");
    expect(out).toContain('title: ""');
  });

  it("reports 404 as NOT_FOUND", async () => {
    mockFetch([{ url: /./, res: new Response("", { status: 404 }) }]);
    const { out, code } = await run(
      "task",
      PROJECT,
      "a00000000000000000000099",
    );
    expect(code).toBe(1);
    expect(out).toContain("code: NOT_FOUND");
    expect(out).toContain(
      `task a00000000000000000000099 in project ${PROJECT}`,
    );
  });

  it("validates ids and arity", async () => {
    expect((await run("task", PROJECT)).code).toBe(2);
    expect((await run("task", PROJECT, "bad/id")).out).toContain(
      "invalid task id",
    );
  });

  it("prints per-command help", async () => {
    const { out, code } = await run("task", "--help");
    expect(code).toBe(0);
    expect(out).toContain("usage: ticktick-axi task <projectId> <taskId>");
  });
});
