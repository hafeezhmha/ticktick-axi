import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { batchIo } from "../src/commands/batch.js";
import { isolate, json, mockFetch, PROJECT, PROJECT2, run } from "./support.js";

const T1 = "a00000000000000000000001";
const GROUP = "6436176a47fd2e05f26ef56e";
const COL = "6226ff9e76e5fc39f2862d1b";

const project = (over: Record<string, unknown> = {}) => ({
  id: PROJECT,
  name: "Home",
  color: "#F18181",
  closed: false,
  groupId: GROUP,
  viewMode: "list",
  permission: "write",
  kind: "TASK",
  sortOrder: 0,
  ...over,
});

const getProject = (p: unknown = project()) => ({
  method: "GET",
  url: new RegExp(`/project/${PROJECT}$`),
  res: json(p),
});
const projectData = (tasks = 2, columns = 1) => ({
  method: "GET",
  url: /\/data$/,
  res: json({
    project: project(),
    tasks: Array.from({ length: tasks }, (_, i) => ({ id: `t${i}` })),
    columns: Array.from({ length: columns }, (_, i) => ({ id: `c${i}` })),
  }),
});
const listProjects = (list: unknown = [project()]) => ({
  method: "GET",
  url: /\/project$/,
  res: json(list),
});
const task = (over: Record<string, unknown> = {}) => ({
  id: T1,
  projectId: PROJECT,
  title: "Plan the trip",
  status: 0,
  ...over,
});
const getTask = (t: unknown = task()) => ({
  method: "GET",
  url: /\/task\/[^/]+$/,
  res: json(t),
});
const members = (list: unknown) => ({
  method: "GET",
  url: /\/members$/,
  res: json(list),
});

const originalIo = { ...batchIo };

beforeEach(() => {
  isolate();
});

afterEach(() => {
  Object.assign(batchIo, originalIo);
});

describe("help", () => {
  it("every new command has --help with usage and examples", async () => {
    for (const c of [
      "project",
      "groups",
      "group",
      "columns",
      "column",
      "tags",
      "tag",
      "assign",
      "unassign",
      "batch",
    ]) {
      const { out, code } = await run(c, "--help");
      expect(code, c).toBe(0);
      expect(out, c).toContain(`usage: ticktick-axi ${c}`);
      expect(out, c).toContain("examples:");
    }
  });

  it("subcommands are strict, with targeted hints", async () => {
    for (const argv of [
      ["project"],
      ["project", "frob"],
      ["group", "list"],
      ["column", "delete"],
      ["tag", "delete"],
    ]) {
      const { out, code } = await run(...argv);
      expect(code, argv.join(" ")).toBe(2);
      expect(out).toContain("Use one of:");
    }
    expect((await run("group", "list")).out).toContain("ticktick-axi groups");
    expect((await run("tag", "delete")).out).toContain("no tag delete");
    expect((await run("project", "toString")).code).toBe(2);
  });
});

describe("project show / members", () => {
  it("shows settings with open-task and column counts", async () => {
    mockFetch([getProject(project({ viewMode: "kanban" })), projectData(3, 2)]);
    const { out, code } = await run("project", "show", PROJECT);
    expect(code).toBe(0);
    expect(out).toContain("name: Home");
    expect(out).toContain("view: kanban");
    expect(out).toContain("open_tasks: 3");
    expect(out).toContain("columns: 2");
    expect(out).toContain(`columns ${PROJECT}`);
  });

  it("tolerates a sparse project and odd data", async () => {
    mockFetch([
      getProject({}),
      { method: "GET", url: /\/data$/, res: json({ tasks: "x" }) },
    ]);
    const { out, code } = await run("project", "show", PROJECT);
    expect(code).toBe(0);
    expect(out).toContain("open_tasks: 0");
    expect(out).toContain("kind: task");
  });

  it("rejects bad ids before calling the API", async () => {
    const calls = mockFetch([]);
    const { out, code } = await run("project", "show", "../etc");
    expect(code).toBe(2);
    expect(out).toContain("ticktick-axi projects");
    expect(calls).toHaveLength(0);
    expect((await run("project", "show", PROJECT, "--x")).code).toBe(2);
  });

  it("lists members, or says the project is not shared", async () => {
    mockFetch([
      members([
        { username: "me@example.com", displayName: "Me", self: true },
        { username: "pal@example.com", displayName: "Pal", self: false },
      ]),
    ]);
    const { out } = await run("project", "members", PROJECT);
    expect(out).toContain("count: 2 member(s)");
    expect(out).toContain("pal@example.com,Pal,false");
    mockFetch([members(null)]);
    expect((await run("project", "members", PROJECT)).out).toContain(
      "0 members found",
    );
  });
});

describe("project create", () => {
  it("previews, flags a duplicate name, sends nothing", async () => {
    const calls = mockFetch([listProjects()]);
    const { out, code } = await run(
      "project",
      "create",
      "home",
      "--color",
      "a1b2c3",
      "--view",
      "Kanban",
      "--kind",
      "note",
      "--sort-order",
      "-5",
    );
    expect(code).toBe(0);
    expect(out).toContain("dry_run: nothing was sent");
    expect(out).toContain("color: #A1B2C3");
    expect(out).toContain("view: kanban");
    expect(out).toContain("kind: note");
    expect(out).toContain("sortOrder: -5");
    expect(out).toContain("already exists");
    expect(out).toContain("project create home --color a1b2c3");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("creates with --yes, sending the documented body", async () => {
    const calls = mockFetch([
      {
        method: "POST",
        url: /\/project$/,
        res: json(project({ id: PROJECT2, name: "Trip" })),
      },
    ]);
    const { out, code } = await run(
      "project",
      "create",
      "Trip",
      "--color",
      "#f18181",
      "--yes",
    );
    expect(code).toBe(0);
    expect(calls[0].body).toEqual({ name: "Trip", color: "#F18181" });
    expect(out).toContain(`id: ${PROJECT2}`);
    expect(out).toContain(`--project ${PROJECT2}`);
  });

  it("validates input", async () => {
    mockFetch([]);
    for (const argv of [
      ["project", "create", "  "],
      ["project", "create", "X", "--color", "red"],
      ["project", "create", "X", "--view", "board"],
      ["project", "create", "X", "--kind", "habit"],
      ["project", "create", "X", "--sort-order", "1.5"],
      ["project", "create", "X", "--name", "Y"],
      ["project", "create", "X", "--group", GROUP],
    ]) {
      expect((await run(...argv)).code, argv.join(" ")).toBe(2);
    }
  });
});

describe("project edit", () => {
  it("shows old and new values, sends only what changed", async () => {
    const calls = mockFetch([
      getProject(),
      {
        method: "POST",
        url: new RegExp(`/project/${PROJECT}$`),
        res: json(project({ name: "House" })),
      },
    ]);
    const dry = await run(
      "project",
      "edit",
      PROJECT,
      "--name",
      "House",
      "--color",
      "f18181",
      "--view",
      "kanban",
    );
    expect(dry.out).toContain("dry_run: nothing was sent");
    expect(dry.out).toContain("name,Home,House");
    expect(dry.out).toContain("view,list,kanban");
    expect(dry.out).not.toContain("color,");
    const { out, code } = await run(
      "project",
      "edit",
      PROJECT,
      "--name",
      "House",
      "--sort-order",
      "3",
      "--kind",
      "task",
      "--yes",
    );
    expect(code).toBe(0);
    expect(calls.at(-1)?.body).toEqual({ name: "House", sortOrder: 3 });
    expect(out).toContain("updated:");
  });

  it("is a no-op when already as requested, and needs a change", async () => {
    mockFetch([getProject()]);
    const same = await run("project", "edit", PROJECT, "--name", "Home");
    expect(same.code).toBe(0);
    expect(same.out).toContain("no changes");
    expect((await run("project", "edit", PROJECT)).code).toBe(2);
  });

  it("treats a missing field as a change", async () => {
    const calls = mockFetch([
      getProject({ id: PROJECT }),
      { method: "POST", url: /\/project\//, res: json(null) },
    ]);
    const { out } = await run(
      "project",
      "edit",
      PROJECT,
      "--color",
      "000000",
      "--name",
      "N",
      "--yes",
    );
    expect(out).toContain("color,none");
    expect(out).toContain("name: N");
    expect(calls.at(-1)?.body).toEqual({ name: "N", color: "#000000" });
  });
});

describe("project delete", () => {
  it("says what goes with it, then deletes with --yes", async () => {
    const calls = mockFetch([
      getProject(),
      projectData(2, 1),
      { method: "DELETE", url: /./, res: new Response("") },
    ]);
    const dry = await run("project", "delete", PROJECT);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would_delete:");
    expect(dry.out).toContain("2 open task(s) and its completed tasks");
    expect(dry.out).toContain("1 column(s)");
    expect(dry.out).toContain(`tasks --project ${PROJECT}`);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const { out } = await run("project", "delete", PROJECT, "--yes");
    expect(out).toContain("deleted:");
    expect(calls.at(-1)?.url).toMatch(new RegExp(`/project/${PROJECT}$`));
  });

  it("an empty project has nothing extra to review", async () => {
    mockFetch([getProject(), projectData(0, 0)]);
    const { out } = await run("project", "delete", PROJECT);
    expect(out).toContain("0 open task(s)");
    expect(out).not.toContain("column(s)");
    expect(out).not.toContain("review its tasks");
  });

  it("refuses the Inbox", async () => {
    mockFetch([]);
    const { out, code } = await run("project", "delete", "inbox123456");
    expect(code).toBe(2);
    expect(out).toContain("Inbox cannot be deleted");
  });
});

describe("groups", () => {
  const groups = (list: unknown) => ({
    method: "GET",
    url: /\/project\/group$/,
    res: json(list),
  });

  it("lists groups with project counts", async () => {
    mockFetch([
      groups([
        { id: "g2", name: "Work", sortOrder: 2 },
        { id: GROUP, name: "Life", sortOrder: 1 },
      ]),
      listProjects([project(), project({ id: PROJECT2 })]),
    ]);
    const { out, code } = await run("groups");
    expect(code).toBe(0);
    expect(out).toContain("count: 2 project group(s)");
    expect(out.indexOf("Life")).toBeLessThan(out.indexOf("Work"));
    expect(out).toContain(`${GROUP},Life,2`);
    expect(out).toContain("g2,Work,0");
  });

  it("says when there are none", async () => {
    mockFetch([groups({})]);
    expect((await run("groups")).out).toContain("0 project groups found");
    expect((await run("groups", "x")).code).toBe(2);
  });

  it("creates after a preview", async () => {
    const calls = mockFetch([
      groups([{ id: GROUP, name: "Life" }]),
      {
        method: "POST",
        url: /\/project\/group$/,
        res: json({ id: "g9", name: "life" }),
      },
    ]);
    const dry = await run("group", "create", "life");
    expect(dry.out).toContain("dry_run: nothing was sent");
    expect(dry.out).toContain("already exists");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const { out } = await run("group", "create", "life", "--yes");
    expect(out).toContain("id: g9");
    expect(calls.at(-1)?.body).toEqual({ name: "life" });
    expect((await run("group", "create", "x".repeat(65))).code).toBe(2);
  });

  it("renames, with a no-op and a not-found", async () => {
    const calls = mockFetch([
      groups([{ id: GROUP, name: "Life" }]),
      {
        method: "POST",
        url: new RegExp(`/project/group/${GROUP}$`),
        res: json({ id: GROUP, name: "Living" }),
      },
    ]);
    expect((await run("group", "edit", GROUP, "--name", "Life")).out).toContain(
      "already has that name (no-op)",
    );
    expect(
      (await run("group", "edit", GROUP, "--name", "Living")).out,
    ).toContain("name,Life,Living");
    const { out } = await run(
      "group",
      "edit",
      GROUP,
      "--name",
      "Living",
      "--yes",
    );
    expect(out).toContain("updated:");
    expect(calls.at(-1)?.body).toEqual({ name: "Living" });
    const missing = await run("group", "edit", "nope", "--name", "X");
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("code: NOT_FOUND");
    expect((await run("group", "edit", GROUP)).code).toBe(2);
    expect((await run("group", "edit", "a/b", "--name", "X")).out).toContain(
      "ticktick-axi groups",
    );
  });

  it("delete lists the projects inside, then deletes", async () => {
    const calls = mockFetch([
      groups([{ id: GROUP, name: "Life" }]),
      listProjects([project(), project({ id: PROJECT2, groupId: "other" })]),
      { method: "DELETE", url: /./, res: new Response("") },
    ]);
    const dry = await run("group", "delete", GROUP);
    expect(dry.out).toContain("projects_in_group[1]");
    expect(dry.out).toContain("do not say whether they are kept");
    await run("group", "delete", GROUP, "--yes");
    expect(calls.at(-1)?.method).toBe("DELETE");
    expect(calls.at(-1)?.url).toMatch(new RegExp(`/project/group/${GROUP}$`));
  });

  it("delete of an empty group says so", async () => {
    mockFetch([groups([{ id: GROUP, name: "Life" }]), listProjects([])]);
    expect((await run("group", "delete", GROUP)).out).toContain(
      "0 projects in this group",
    );
  });
});

describe("columns", () => {
  const columns = (list: unknown) => ({
    method: "GET",
    url: /\/column$/,
    res: json(list),
  });

  it("lists in board order, or says there are none", async () => {
    mockFetch([
      columns([
        { id: "c2", name: "Done", sortOrder: 5 },
        { id: COL, name: "To do", sortOrder: 1 },
      ]),
    ]);
    const { out } = await run("columns", PROJECT);
    expect(out).toContain("count: 2 column(s)");
    expect(out.indexOf("To do")).toBeLessThan(out.indexOf("Done"));
    mockFetch([columns("nope")]);
    const empty = await run("columns", PROJECT);
    expect(empty.out).toContain("0 columns found");
    expect(empty.out).toContain("--view kanban");
  });

  it("create previews the project view and duplicates, then sends", async () => {
    const calls = mockFetch([
      getProject(),
      columns([{ id: COL, name: "Doing" }]),
      {
        method: "POST",
        url: new RegExp(`/project/${PROJECT}/column$`),
        res: json({ id: "c9", name: "Doing" }),
      },
    ]);
    const dry = await run("column", "create", PROJECT, "doing");
    expect(dry.out).toContain("dry_run: nothing was sent");
    expect(dry.out).toContain("column 2");
    expect(dry.out).toContain("already exists");
    expect(dry.out).toContain("only in kanban view");
    expect(dry.out).toContain("cannot delete a column");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const { out } = await run("column", "create", PROJECT, "Doing", "--yes");
    expect(out).toContain("id: c9");
    expect(calls.at(-1)?.body).toEqual({ name: "Doing" });
  });

  it("create in a kanban project has no view note", async () => {
    mockFetch([getProject(project({ viewMode: "kanban" })), columns([])]);
    const { out } = await run("column", "create", PROJECT, "New");
    expect(out).not.toContain("only in kanban view");
    expect(out).toContain("column 1");
  });

  it("edit renames, with a no-op and a not-found", async () => {
    const calls = mockFetch([
      columns([{ id: COL, name: "Doing" }]),
      {
        method: "POST",
        url: new RegExp(`/column/${COL}$`),
        res: json({ id: COL, name: "In progress" }),
      },
    ]);
    expect(
      (await run("column", "edit", PROJECT, COL, "--name", "Doing")).out,
    ).toContain("(no-op)");
    expect(
      (await run("column", "edit", PROJECT, COL, "--name", "In progress")).out,
    ).toContain("dry_run: nothing was sent");
    await run("column", "edit", PROJECT, COL, "--name", "In progress", "--yes");
    expect(calls.at(-1)?.body).toEqual({ name: "In progress" });
    const missing = await run("column", "edit", PROJECT, "nope", "--name", "X");
    expect(missing.out).toContain("code: NOT_FOUND");
    expect((await run("column", "edit", PROJECT, COL)).code).toBe(2);
  });
});

describe("tags", () => {
  const tags = (list: unknown) => ({
    method: "GET",
    url: /\/tag$/,
    res: json(list),
  });

  it("lists tags, with parents only when nested and more with --full", async () => {
    mockFetch([
      tags([
        { name: "work", label: "Work", sortOrder: 2, color: "#fff", type: 1 },
        { name: "urgent", label: "Urgent", sortOrder: 1, type: 2 },
      ]),
    ]);
    const { out } = await run("tags");
    expect(out).toContain("count: 2 tag(s)");
    expect(out).toContain("tags[2]{name,label}");
    expect(out.indexOf("urgent")).toBeLessThan(out.indexOf("work"));
    expect((await run("tags", "--full")).out).toContain(
      "tags[2]{name,label,color,type}",
    );
    mockFetch([tags([{ name: "a" }, { name: "b", parent: "a" }])]);
    expect((await run("tags")).out).toContain("{name,label,parent}");
  });

  it("says when there are none", async () => {
    mockFetch([tags(null)]);
    expect((await run("tags")).out).toContain("0 tags found");
    expect((await run("tags", "x")).code).toBe(2);
  });

  it("create lowercases the name, and an existing tag is a no-op", async () => {
    const calls = mockFetch([
      tags([{ name: "work", label: "Work" }]),
      {
        method: "POST",
        url: /\/tag$/,
        res: json({ name: "errands", label: "Errands" }),
      },
    ]);
    const same = await run("tag", "create", "WORK");
    expect(same.code).toBe(0);
    expect(same.out).toContain("already exists (no-op)");
    const dry = await run("tag", "create", "Errands");
    expect(dry.out).toContain("name: errands");
    expect(dry.out).toContain("cannot rename or delete");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    const { out } = await run("tag", "create", "Errands", "--yes");
    expect(out).toContain("created:");
    expect(calls.at(-1)?.body).toEqual({ name: "errands", label: "Errands" });
    expect((await run("tag", "create", "x".repeat(65))).code).toBe(2);
    expect((await run("tag", "create", "x", "--color", "red")).code).toBe(2);
  });
});

describe("assign / unassign", () => {
  const team = members([
    { username: "me@example.com", displayName: "Me", self: true },
    { username: "Pal@example.com", displayName: "Pal", self: false },
  ]);

  it("checks the username against the members before sending", async () => {
    const calls = mockFetch([getTask(), team]);
    const { out, code } = await run("assign", PROJECT, T1, "nobody@x.com");
    expect(code).toBe(1);
    expect(out).toContain("is not a member");
    expect(out).toContain(`project members ${PROJECT}`);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    mockFetch([getTask(), members([])]);
    expect((await run("assign", PROJECT, T1, "x")).out).toContain("not shared");
  });

  it("previews, then assigns with --yes (username matched case-insensitively)", async () => {
    const calls = mockFetch([
      getTask(),
      team,
      {
        method: "POST",
        url: /\/task\/assign$/,
        res: json(task({ assigneeUsername: "Pal@example.com" })),
      },
    ]);
    const dry = await run("assign", PROJECT, T1, "pal@example.com");
    expect(dry.out).toContain(
      "assignee: none reported -> Pal@example.com (Pal)",
    );
    expect(dry.out).toContain(`assign ${PROJECT} ${T1} Pal@example.com --yes`);
    const { out } = await run(
      "assign",
      PROJECT,
      T1,
      "pal@example.com",
      "--yes",
    );
    expect(out).toContain("assignee: Pal@example.com");
    expect(calls.at(-1)?.body).toEqual({
      projectId: PROJECT,
      taskId: T1,
      assigneeUsername: "Pal@example.com",
    });
  });

  it("assigning the current assignee is a no-op", async () => {
    mockFetch([getTask(task({ assigneeUsername: "me@example.com" })), team]);
    const { out, code } = await run("assign", PROJECT, T1, "me@example.com");
    expect(code).toBe(0);
    expect(out).toContain("already assigned");
    expect((await run("assign", PROJECT, T1, " ")).code).toBe(2);
    expect((await run("assign", PROJECT, T1, "--to", "x")).code).toBe(2);
  });

  it("unassign previews, sends, and is a no-op without an assignee", async () => {
    const calls = mockFetch([
      getTask(task({ assigneeUsername: "me@example.com" })),
      { method: "POST", url: /\/task\/unassign$/, res: json(task()) },
    ]);
    expect((await run("unassign", PROJECT, T1)).out).toContain(
      "assignee: me@example.com -> none",
    );
    const { out } = await run("unassign", PROJECT, T1, "--yes");
    expect(out).toContain("was: me@example.com");
    expect(calls.at(-1)?.body).toEqual({ projectId: PROJECT, taskId: T1 });
    mockFetch([getTask(task({ assigneeUsername: null }))]);
    expect((await run("unassign", PROJECT, T1)).out).toContain(
      "has no assignee (no-op)",
    );
    // The live API leaves the field out when there is none: not a sure no-op.
    const unknown = mockFetch([
      getTask(task()),
      { method: "POST", url: /\/task\/unassign$/, res: json(task()) },
    ]);
    expect((await run("unassign", PROJECT, T1)).out).toContain(
      "none reported by TickTick -> none",
    );
    expect((await run("unassign", PROJECT, T1, "--yes")).out).toContain(
      "was: none reported",
    );
    expect(unknown.at(-1)?.url).toMatch(/\/task\/unassign$/);
  });
});

describe("batch", () => {
  const input = (data: unknown) => {
    batchIo.readFile = () =>
      typeof data === "string" ? data : JSON.stringify(data);
  };
  const batchRoute = (res: unknown) => ({
    method: "POST",
    url: /\/task\/batch$/,
    res: json(res),
  });

  it("previews adds and updates with friendly dates converted", async () => {
    input({
      add: [
        {
          title: " Buy milk ",
          projectId: PROJECT,
          dueDate: "2026-10-10",
          priority: "high",
          tags: ["home"],
        },
        {
          title: "Call",
          projectId: "inbox1234567",
          dueDate: "2026-10-10T09:30",
        },
      ],
      update: [
        {
          id: T1,
          projectId: PROJECT,
          title: "Renamed",
          items: [{ title: "a" }],
        },
      ],
    });
    const calls = mockFetch([listProjects()]);
    const { out, code } = await run("batch", "--file", "tasks.json");
    expect(code).toBe(0);
    expect(out).toContain("dry_run: nothing was sent");
    expect(out).toContain("would_add: 2 task(s)");
    expect(out).toContain("2026-10-10 (all day)");
    expect(out).toContain('"2026-10-10 09:30"');
    expect(out).toContain("priority=5 tags=home");
    expect(out).toContain("title=Renamed items=1 item(s)");
    expect(out).toContain("replaces that whole list");
    expect(out).toContain("batch --file tasks.json --yes");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("sends the documented body and reports results per id", async () => {
    input({
      add: [{ title: "New", projectId: PROJECT, dueDate: "2026-10-10" }],
      update: [
        { id: T1, projectId: PROJECT, dueDate: null, repeatFrom: 2 },
        { id: "b1", projectId: PROJECT, kind: "note" },
      ],
    });
    const calls = mockFetch([
      batchRoute({
        id2etag: { n1: "e1", [T1]: "e2" },
        id2error: { b1: "NOT_EXISTED", b2: "WEIRD" },
      }),
    ]);
    const { out, code } = await run("batch", "--file", "x.json", "--yes");
    expect(code).toBe(0);
    expect(calls[0].body).toEqual({
      add: [
        {
          title: "New",
          projectId: PROJECT,
          dueDate: "2026-10-09T18:30:00+0000",
          isAllDay: true,
          timeZone: "Asia/Kolkata",
        },
      ],
      update: [
        { id: T1, projectId: PROJECT, dueDate: null, repeatFrom: "2" },
        { id: "b1", projectId: PROJECT, kind: "NOTE" },
      ],
    });
    expect(out).toContain("result: 2 of 3 applied");
    expect(out).toContain("created: 1 of 1");
    expect(out).toContain("updated: 1 of 2");
    expect(out).toContain("b1,NOT_EXISTED,no task with this id");
    expect(out).toContain("WEIRD,not documented");
    expect(out).toContain("send only those again");
  });

  it("reads stdin, and refuses a terminal", async () => {
    batchIo.stdinIsTTY = () => true;
    expect((await run("batch", "--stdin")).out).toContain("from a pipe");
    batchIo.stdinIsTTY = () => false;
    batchIo.readStdin = async () =>
      JSON.stringify({ add: [{ title: "A", projectId: PROJECT2 }] });
    mockFetch([listProjects()]);
    const { out } = await run("batch", "--stdin");
    expect(out).toContain(`project ${PROJECT2} is not in your project list`);
    expect(out).toContain("batch --stdin --yes");
    mockFetch([batchRoute({ id2etag: { n1: "e" } })]);
    const sent = await run("batch", "--stdin", "--yes");
    expect(sent.out).toContain("created_ids[1]: n1");
    expect(sent.out).toContain(`tasks --project ${PROJECT2}`);
  });

  it("reports WRITE_UNCERTAIN on an unexpected response", async () => {
    input({ update: [{ id: T1, projectId: PROJECT, title: "X" }] });
    mockFetch([batchRoute([])]);
    const { out, code } = await run("batch", "--file", "x", "--yes");
    expect(code).toBe(1);
    expect(out).toContain("code: WRITE_UNCERTAIN");
    mockFetch([batchRoute({})]);
    expect((await run("batch", "--file", "x", "--yes")).out).toContain(
      "0 of 1 applied",
    );
  });

  it("catches mistakes before anything is sent", async () => {
    const calls = mockFetch([]);
    const many = Array.from({ length: 51 }, () => ({
      title: "x",
      projectId: PROJECT,
    }));
    const cases: Array<[unknown, string]> = [
      ["{not json", "not valid JSON"],
      [[1], "must be a JSON object"],
      [{ add: [], extra: 1 }, 'unknown key "extra"'],
      [{ add: {} }, "must be an array"],
      [{ add: many }, "at most 50"],
      [{ add: [] }, "nothing to send"],
      [{ add: [5] }, "add[0]: must be a JSON object"],
      [{ add: [{ title: "x" }] }, '"projectId" is required'],
      [{ update: [{ projectId: PROJECT }] }, '"id" is required'],
      [{ add: [{ projectId: PROJECT }] }, '"title" cannot be empty'],
      [{ add: [{ title: "x", projectId: "inbox" }] }, "real id"],
      [{ add: [{ title: "x", projectId: "a/b" }] }, "invalid project id"],
      [
        { add: [{ title: "x", projectId: PROJECT, foo: 1 }] },
        'unknown field "foo"',
      ],
      [{ add: [{ title: 5, projectId: PROJECT }] }, '"title" must be a string'],
      [
        { add: [{ title: "x", projectId: PROJECT, priority: 2 }] },
        '"priority" 2',
      ],
      [{ add: [{ title: "x", projectId: PROJECT, status: 1 }] }, '"status"'],
      [
        { add: [{ title: "x", projectId: PROJECT, isAllDay: "yes" }] },
        "isAllDay",
      ],
      [
        { add: [{ title: "x", projectId: PROJECT, timeZone: "Mars/X" }] },
        "IANA",
      ],
      [
        { add: [{ title: "x", projectId: PROJECT, sortOrder: 1.5 }] },
        "sortOrder",
      ],
      [
        { add: [{ title: "x", projectId: PROJECT, repeatFrom: "9" }] },
        "repeatFrom",
      ],
      [{ add: [{ title: "x", projectId: PROJECT, kind: "habit" }] }, '"kind"'],
      [
        { add: [{ title: "x", projectId: PROJECT, tags: "a" }] },
        '"tags" must be',
      ],
      [
        { add: [{ title: "x", projectId: PROJECT, items: [{}] }] },
        '"items" must be',
      ],
      [
        { add: [{ title: "x", projectId: PROJECT, dueDate: null }] },
        "cannot be null",
      ],
      [
        { add: [{ title: "x", projectId: PROJECT, dueDate: 5 }] },
        "date string",
      ],
      [
        { add: [{ title: "x", projectId: PROJECT, dueDate: "soon" }] },
        "not a valid date",
      ],
      [
        {
          add: [
            {
              title: "x",
              projectId: PROJECT,
              dueDate: "2026-10-10",
              startDate: "2026-10-09T10:00",
            },
          ],
        },
        "both be dates",
      ],
      [
        {
          update: [
            { id: T1, projectId: PROJECT, title: "a" },
            { id: T1, projectId: PROJECT, title: "b" },
          ],
        },
        "more than once",
      ],
    ];
    for (const [data, msg] of cases) {
      input(data);
      const { out, code } = await run("batch", "--file", "x.json");
      expect(code, msg).toBe(2);
      expect(out.replace(/\\"/g, '"'), msg).toContain(msg);
    }
    expect(calls).toHaveLength(0);
  });

  it("needs exactly one input source, and a readable file", async () => {
    mockFetch([]);
    expect((await run("batch")).out).toContain("--file <path> or --stdin");
    expect((await run("batch", "--file", "x", "--stdin")).out).toContain(
      "cannot be combined",
    );
    expect((await run("batch", "x.json")).code).toBe(2);
    batchIo.readFile = () => {
      throw new Error("ENOENT");
    };
    expect((await run("batch", "--file", "nope.json")).out).toContain(
      "could not read nope.json",
    );
    batchIo.readFile = () => "x".repeat(1_000_001);
    expect((await run("batch", "--file", "big.json")).out).toContain(
      "over 1 MB",
    );
  });
});
