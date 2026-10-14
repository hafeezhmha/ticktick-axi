import { beforeEach, describe, expect, it, vi } from "vitest";
import { isolate, json, mockFetch, run, type Route } from "./support.js";

// NOW is Friday 2026-10-09 12:00 in Asia/Kolkata.
const H1 = "b00000000000000000000001";
const H2 = "b00000000000000000000002";
const H3 = "b00000000000000000000003";
const S1 = "c00000000000000000000001";
const F1 = "d00000000000000000000001";

const habit = (over: Record<string, unknown> = {}) => ({
  id: H1,
  name: "Read",
  type: "Boolean",
  goal: 1,
  step: 1,
  unit: "Count",
  repeatRule: "RRULE:FREQ=DAILY;INTERVAL=1",
  status: 0,
  totalCheckIns: 12,
  sectionId: S1,
  ...over,
});

const water = habit({
  id: H2,
  name: "Drink water",
  type: "Real",
  goal: 8,
  unit: "Glass",
});
const gym = habit({
  id: H3,
  name: "Gym",
  repeatRule: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,SA",
});
const archived = habit({ id: "b0000000000000000000000a", status: 1 });

const doc = (habitId: string, checkins: unknown[]) => ({
  habitId,
  year: 2026,
  checkins,
});

const habitsRoute = (list: unknown): Route => ({
  method: "GET",
  url: /\/habit$/,
  res: json(list),
});
const checkinsRoute = (list: unknown): Route => ({
  method: "GET",
  url: /\/habit\/checkins\?/,
  res: json(list),
});
const getHabit = (h: unknown): Route => ({
  method: "GET",
  url: /\/habit\/b[0-9a]+$/,
  res: json(h),
});
const sectionsRoute: Route = {
  method: "GET",
  url: /\/habit\/sections$/,
  res: json([
    { id: S1, name: "Health", sortOrder: 2 },
    { id: "c00000000000000000000002", name: "Mind", sortOrder: 1 },
  ]),
};

beforeEach(() => {
  isolate();
});

describe("habits", () => {
  it("shows today and the last 7 days, hiding archived habits", async () => {
    const calls = mockFetch([
      habitsRoute([habit(), water, gym, archived]),
      checkinsRoute([
        doc(H1, [
          { stamp: 20261009, value: 1, goal: 1 },
          { stamp: 20261008, value: 1, goal: 1 },
          { stamp: 20261001, value: 1, goal: 1 }, // outside the window
        ]),
        doc(H2, [{ stamp: 20261009, value: 3, goal: 8 }]),
        doc(H3, [{ stamp: 20261007, value: 1, goal: 1, status: 2 }]),
      ]),
    ]);
    const { out, code } = await run("habits");
    expect(code).toBe(0);
    const q = new URL(calls[1].url).searchParams;
    expect(q.get("habitIds")).toBe(`${H1},${H2},${H3}`);
    expect(q.get("from")).toBe("20261003");
    expect(q.get("to")).toBe("20261009");
    expect(out).toContain("count: 3 of 4 habits (1 archived hidden)");
    expect(out).toContain('today: "2026-10-09: 1 of 2 done"');
    expect(out).toContain(`${H1},Read,done,2/7`);
    expect(out).toContain(`${H2},Drink water,3/8 Glass,0/7`);
    expect(out).toContain(`${H3},Gym,not scheduled,1/3`);
    expect(out).toContain("habits --archived");
  });

  it("adds columns, includes archived and filters by section", async () => {
    mockFetch([habitsRoute([habit(), water, archived]), checkinsRoute(null)]);
    const { out } = await run(
      "habits",
      "--archived",
      "--fields",
      "repeat,goal,section,total",
    );
    expect(out).toContain("{id,name,today,last_7,repeat,goal,section,total}");
    expect(out).toContain(
      `${H2},Drink water,not yet,0/7,daily,8 Glass,${S1},12`,
    );
    expect(out).toContain("Read (archived)");
    const other = await run("habits", "--section", "c00000000000000000000002");
    expect(other.out).toContain("0 habits found in that section");
  });

  it("says when there are none, and rejects bad flags", async () => {
    mockFetch([habitsRoute([])]);
    expect((await run("habits")).out).toContain("habits: 0 habits found");
    expect((await run("habits", "--fields", "colour")).code).toBe(2);
    expect((await run("habits", "--all")).out).toContain("--archived");
    expect((await run("habits", "x")).code).toBe(2);
    mockFetch([habitsRoute([archived])]);
    expect((await run("habits")).out).toContain("(1 archived hidden)");
  });
});

describe("habit show / sections", () => {
  it("shows kind, streak and the recent days", async () => {
    mockFetch([
      getHabit(gym),
      checkinsRoute([
        doc(H3, [
          { stamp: 20261007, value: 1 }, // Wed
          { stamp: 20261005, value: 1 }, // Mon
          { stamp: 20261003, value: 1 }, // Sat
          { stamp: 20260930, value: 0 }, // Wed: not done
        ]),
      ]),
    ]);
    const { out, code } = await run("habit", "show", H3);
    expect(code).toBe(0);
    expect(out).toContain("kind: yes/no");
    expect(out).toContain('repeat: "weekly MO,WE,SA"');
    expect(out).toContain("today: not scheduled");
    expect(out).toContain("streak: 3 day(s)");
    expect(out).toContain("recent[7]{date,state}:");
    expect(out).toContain("2026-10-07,done");
    expect(out).toContain("2026-10-06,not scheduled");
  });

  it("counts a full window, and shows numeric goals", async () => {
    const all = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 9, 9 - i));
      return {
        stamp: Number(d.toISOString().slice(0, 10).replace(/-/g, "")),
        value: 8,
      };
    });
    mockFetch([
      getHabit({ ...water, encouragement: "x".repeat(1200) }),
      checkinsRoute([doc(H2, all)]),
    ]);
    const { out } = await run("habit", "show", H2);
    expect(out).toContain("60+ day(s) (whole window)");
    expect(out).toContain("numeric: goal 8 Glass a day, step 1");
    expect(out).toContain(`habit show ${H2} --full`);
  });

  it("points a 404 at the habit list", async () => {
    mockFetch([{ method: "GET", url: /\/habit\//, res: json({}, 404) }]);
    const { out, code } = await run("habit", "show", H1);
    expect(code).toBe(1);
    expect(out).toContain("code: NOT_FOUND");
    expect(out).toContain("ticktick-axi habits --archived");
    expect((await run("habit", "show", "bad id!")).code).toBe(2);
  });

  it("lists sections in order with habit counts", async () => {
    mockFetch([sectionsRoute, habitsRoute([habit(), water, archived])]);
    const { out } = await run("habit", "sections");
    expect(out).toContain("count: 2 habit section(s)");
    expect(out.indexOf("Mind")).toBeLessThan(out.indexOf("Health"));
    expect(out).toContain(`${S1},Health,2`);
    mockFetch([{ method: "GET", url: /\/habit\/sections$/, res: json([]) }]);
    expect((await run("habit", "sections")).out).toContain(
      "0 habit sections found",
    );
  });

  it("rejects unknown subcommands", async () => {
    expect((await run("habit")).code).toBe(2);
    const { out } = await run("habit", "delete", H1);
    expect(out).toContain("unknown habit subcommand");
  });
});

describe("habit checkins", () => {
  it("defaults to active habits and the last 7 days, newest first", async () => {
    const calls = mockFetch([
      habitsRoute([habit(), water, archived]),
      checkinsRoute([
        doc(H1, [
          { stamp: 20261005, value: 1, goal: 1 },
          { stamp: 20261008, value: 1, goal: 1 },
        ]),
        doc(H2, [{ stamp: 20261008, value: 2, goal: 8 }]),
      ]),
    ]);
    const { out, code } = await run("habit", "checkins");
    expect(code).toBe(0);
    expect(new URL(calls[1].url).searchParams.get("habitIds")).toBe(
      `${H1},${H2}`,
    );
    expect(out).toContain(
      "3 of 3 check-ins 2026-10-03 to 2026-10-09 (2 done) for 2 habit(s)",
    );
    expect(out.indexOf("2026-10-08")).toBeLessThan(out.indexOf("2026-10-05"));
    expect(out).toContain(`2026-10-08,${H2},Drink water,2/8,partial`);
  });

  it("takes ids and a range, limits rows, and refuses unknown ids", async () => {
    const calls = mockFetch([
      habitsRoute([habit(), water]),
      checkinsRoute([
        doc(H1, [
          { stamp: 20260915, value: 1 },
          { stamp: 20260916, value: 0 },
        ]),
      ]),
    ]);
    const { out } = await run(
      "habit",
      "checkins",
      H1,
      "--from",
      "2026-09-01",
      "--to",
      "2026-09-30T10:00",
      "--limit",
      "1",
    );
    const q = new URL(calls[1].url).searchParams;
    expect([q.get("habitIds"), q.get("from"), q.get("to")]).toEqual([
      H1,
      "20260901",
      "20260930",
    ]);
    expect(out).toContain("Add --limit 2 to see all 2");
    expect((await run("habit", "checkins", H3)).out).toContain(
      "code: NOT_FOUND",
    );
    expect(
      (await run("habit", "checkins", "--from", "today", "--to", "-1d")).code,
    ).toBe(2);
  });

  it("says when there are no habits or no check-ins", async () => {
    mockFetch([habitsRoute([habit()]), checkinsRoute([])]);
    expect((await run("habit", "checkins", "--from", "today")).out).toContain(
      "0 check-ins 2026-10-09 for 1 habit(s)",
    );
    mockFetch([habitsRoute([])]);
    expect((await run("habit", "checkins")).out).toContain("0 habits found");
  });
});

describe("habit checkin", () => {
  const post = (res: unknown): Route => ({
    method: "POST",
    url: /\/checkin$/,
    res: json(res),
  });

  it("previews, then sends stamp, value and goal with --yes", async () => {
    const calls = mockFetch([
      getHabit(habit()),
      checkinsRoute([]),
      post(doc(H1, [{ stamp: 20261009, value: 1, goal: 1 }])),
    ]);
    const dry = await run("habit", "checkin", H1);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("dry_run: nothing was sent");
    expect(dry.out).toContain(
      'would_change: "2026-10-09: no check-in -> done (1/1)"',
    );
    expect(dry.out).toContain(`habit checkin ${H1} --yes`);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    const { out, code } = await run("habit", "checkin", H1, "--yes");
    expect(code).toBe(0);
    expect(calls.at(-1)?.body).toEqual({ stamp: 20261009, value: 1, goal: 1 });
    expect(out).toContain("checked_in:");
    expect(out).not.toContain("note:");
  });

  it("defaults a numeric habit to its goal, and takes --value and --date", async () => {
    const calls = mockFetch([
      getHabit(water),
      checkinsRoute([doc(H2, [{ stamp: 20261008, value: 3, goal: 8 }])]),
      post(doc(H2, [{ stamp: 20261008, value: 4, goal: 8 }])),
    ]);
    const dry = await run("habit", "checkin", H2, "--date", "yesterday");
    expect(dry.out).toContain("2026-10-08: partial (3/8) -> done (8/8)");
    const { out } = await run(
      "habit",
      "checkin",
      H2,
      "--date",
      "2026-10-08",
      "--value",
      "5",
      "--yes",
    );
    expect(calls.at(-1)?.body).toEqual({ stamp: 20261008, value: 5, goal: 8 });
    expect(out).toContain(
      "note: TickTick reports partial (4/8) for 2026-10-08",
    );
  });

  it("is a no-op when already in place, and undoes", async () => {
    const calls = mockFetch([
      getHabit(habit()),
      checkinsRoute([doc(H1, [{ stamp: 20261009, value: 1, goal: 1 }])]),
    ]);
    expect((await run("habit", "checkin", H1)).out).toContain(
      "already done (1/1) (no-op)",
    );
    expect((await run("habit", "checkin", H1, "--undo")).out).toContain(
      "done (1/1) -> not done (0/1)",
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    mockFetch([getHabit(habit()), checkinsRoute([])]);
    expect((await run("habit", "checkin", H1, "--undo")).out).toContain(
      "no check-in to undo (no-op)",
    );
  });

  it("refuses future dates, odd values and conflicting flags", async () => {
    mockFetch([getHabit(habit()), checkinsRoute([])]);
    expect((await run("habit", "checkin", H1, "--date", "tomorrow")).code).toBe(
      2,
    );
    expect((await run("habit", "checkin", H1, "--value", "3")).out).toContain(
      "yes/no habit",
    );
    expect(
      (await run("habit", "checkin", H1, "--value", "1", "--undo")).code,
    ).toBe(2);
    expect((await run("habit", "checkin", H1, "--value", "-1")).code).toBe(2);
    expect((await run("habit", "checkin", H1, "--confirm")).out).toContain(
      "add --yes",
    );
  });
});

describe("habit create", () => {
  it("previews a yes/no habit, then creates it", async () => {
    const calls = mockFetch([
      habitsRoute([water]),
      { method: "POST", url: /\/habit$/, res: json(habit({ id: "new1" })) },
    ]);
    const dry = await run("habit", "create", "Read", "--repeat", "mo,wed,fr");
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("would_create:");
    expect(dry.out).toContain('repeat: "weekly MO,WE,FR"');
    expect(dry.out).toContain("cannot delete habits");
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    const { out } = await run("habit", "create", "Read", "--yes");
    expect(calls.at(-1)?.body).toEqual({
      name: "Read",
      type: "Boolean",
      goal: 1,
      step: 1,
      unit: "Count",
      repeatRule: "RRULE:FREQ=DAILY;INTERVAL=1",
    });
    expect(out).toContain("id: new1");
    expect(out).toContain("habit checkin new1");
  });

  it("makes a numeric habit from --goal, with section and extras", async () => {
    const calls = mockFetch([
      habitsRoute([]),
      sectionsRoute,
      { method: "POST", url: /\/habit$/, res: json({ id: "new2" }) },
    ]);
    const args = [
      "habit",
      "create",
      "Drink water",
      "--goal",
      "8",
      "--unit",
      "Glass",
      "--repeat",
      "weekdays",
      "--section",
      S1,
      "--color",
      "#4D8CF5",
      "--encouragement",
      "Stay hydrated",
    ];
    const dry = await run(...args);
    expect(dry.out).toContain("numeric: goal 8 Glass a day, step 1");
    expect(dry.out).toContain("section: Health");
    expect(dry.out).toContain("repeat: weekdays");
    await run(...args, "--yes");
    expect(calls.at(-1)?.body).toEqual({
      name: "Drink water",
      type: "Real",
      goal: 8,
      step: 1,
      unit: "Glass",
      repeatRule: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
      sectionId: S1,
      color: "#4D8CF5",
      encouragement: "Stay hydrated",
    });
  });

  it("is a no-op for an existing name, and validates input", async () => {
    mockFetch([habitsRoute([habit()]), sectionsRoute]);
    const dup = await run("habit", "create", " read ", "--yes");
    expect(dup.code).toBe(0);
    expect(dup.out).toContain("already exists (no-op)");
    for (const bad of [
      ["--repeat", "fortnightly"],
      ["--goal", "0"],
      ["--goal", "lots"],
      ["--color", "blue"],
      ["--unit", " "],
      ["--section", "no such!"],
      ["--type", "Real"],
    ]) {
      expect((await run("habit", "create", "New", ...bad)).code, bad[0]).toBe(
        2,
      );
    }
    expect((await run("habit", "create", "  ")).code).toBe(2);
    expect((await run("habit", "create", "x".repeat(1001))).code).toBe(2);
    expect(
      (
        await run(
          "habit",
          "create",
          "New",
          "--section",
          "c0000000000000000000000f",
        )
      ).out,
    ).toContain("No habit section");
    const rrule = await run(
      "habit",
      "create",
      "New",
      "--repeat",
      "RRULE:FREQ=WEEKLY;TT_TIMES=3",
    );
    expect(rrule.out).toContain("repeat: FREQ=WEEKLY;TT_TIMES=3");
    expect(
      (await run("habit", "create", "New", "--repeat", "weekends")).out,
    ).toContain("repeat: weekends");
  });
});

describe("habit edit", () => {
  it("previews only real changes, then sends them", async () => {
    const calls = mockFetch([
      getHabit(habit()),
      sectionsRoute,
      { method: "POST", url: /\/habit\/b/, res: json(habit({ goal: 2 })) },
    ]);
    const args = [
      "habit",
      "edit",
      H1,
      "--goal",
      "2",
      "--unit",
      "Count",
      "--repeat",
      "daily",
      "--section",
      "c00000000000000000000002",
      "--encouragement",
      "Go",
    ];
    const dry = await run(...args);
    expect(dry.out).toContain("dry_run: nothing was sent");
    expect(dry.out).toContain('goal,"1","2"');
    expect(dry.out).toContain("kind,yes/no,numeric");
    expect(dry.out).toContain(`section,${S1},Mind`);
    expect(dry.out).not.toContain("unit,");
    expect(dry.out).not.toContain("repeat,");
    await run(...args, "--yes");
    expect(calls.at(-1)?.body).toEqual({
      goal: 2,
      type: "Real",
      sectionId: "c00000000000000000000002",
      encouragement: "Go",
    });
  });

  it("no-ops, needs a change, and renames", async () => {
    const calls = mockFetch([
      getHabit(water),
      { method: "POST", url: /\/habit\/b/, res: json({}) },
    ]);
    expect((await run("habit", "edit", H2, "--goal", "8")).out).toContain(
      "no changes (already as requested)",
    );
    expect((await run("habit", "edit", H2)).code).toBe(2);
    expect((await run("habit", "edit", H2, "--archive")).out).toContain(
      "archive it in TickTick",
    );
    const goal1 = await run("habit", "edit", H2, "--goal", "1");
    expect(goal1.out).toContain("kind,numeric,yes/no");
    const { out } = await run("habit", "edit", H2, "--name", "Water", "--yes");
    expect(calls.at(-1)?.body).toEqual({ name: "Water" });
    expect(out).toContain("updated:");
  });
});

describe("focus", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: F1,
    type: 0,
    startTime: "2026-10-08T03:30:00.000+0000", // 09:00 IST
    endTime: "2026-10-08T03:55:00.000+0000",
    duration: 1_500_000, // the live API sends milliseconds
    pauseDuration: 0,
    tasks: [{ taskId: "t1", title: "Write report" }],
    note: "Deep work",
    ...over,
  });

  it("lists both types for the last 7 days, newest first, with totals", async () => {
    const calls = mockFetch([
      {
        method: "GET",
        url: /\/focus\?.*type=0/,
        res: json([rec(), rec()]),
      },
      {
        method: "GET",
        url: /\/focus\?.*type=1/,
        res: json([
          {
            id: "d00000000000000000000002",
            startTime: "2026-10-09T03:30:00+0000",
            endTime: "2026-10-09T05:00:00+0000",
            duration: 5400, // as documented: seconds
          },
        ]),
      },
    ]);
    const { out, code } = await run("focus");
    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get("from")).toBe("2026-10-02T18:30:00+0000");
    expect(q.get("to")).toBe("2026-10-09T18:29:59+0000");
    expect(calls[0].url).toContain("%2B0000");
    expect(out).toContain("count: 2 of 2 focus records (last 7 days)");
    expect(out).toContain('total: "1h 55m focused (1 pomo, 1 stopwatch)"');
    expect(out.indexOf(",stopwatch,")).toBeLessThan(out.indexOf(",pomo,"));
    expect(out).toContain(`${F1},pomo,"2026-10-08 09:00",25,Write report`);
  });

  it("splits long ranges into 30-day queries and caps at 90 days", async () => {
    const calls = mockFetch([
      { method: "GET", url: /\/focus\?/, res: json([rec()]) },
    ]);
    const { out } = await run(
      "focus",
      "--from",
      "-90d",
      "--type",
      "pomo",
      "--fields",
      "end,note,taskId,pause",
      "--limit",
      "1",
    );
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.url.includes("type=0"))).toBe(true);
    expect(out).toContain("1 of 1 pomo records (2026-07-11 to 2026-10-09)");
    expect(out).toContain(
      "{id,type,start,mins,task,end,note,taskId,pause_mins}",
    );
    expect(out).toContain('Deep work,"",0');
    expect((await run("focus", "--from", "-91d")).code).toBe(2);
    expect((await run("focus", "--from", "today", "--to", "-1d")).code).toBe(2);
    expect((await run("focus", "--type", "nap")).code).toBe(2);
    expect((await run("focus", "--fields", "mood")).code).toBe(2);
    expect((await run("focus", "list")).out).toContain(
      "unknown focus subcommand",
    );
  });

  it("says when there are none, and hints at --limit", async () => {
    mockFetch([{ method: "GET", url: /\/focus\?/, res: json([]) }]);
    expect((await run("focus")).out).toContain(
      "0 focus records found (last 7 days)",
    );
    const many = Array.from({ length: 3 }, (_, i) =>
      rec({ id: `f${i}`, duration: undefined, pauseDuration: 300 }),
    );
    mockFetch([{ method: "GET", url: /\/focus\?/, res: json(many) }]);
    const { out } = await run("focus", "--limit", "2", "--type", "all");
    expect(out).toContain("Add --limit 3 to see all 3");
    expect(out).toContain("1h 00m focused");
  });

  it("show tries pomo, then stopwatch", async () => {
    const calls = mockFetch([
      { method: "GET", url: /type=0/, res: json({}, 404) },
      {
        method: "GET",
        url: /type=1/,
        res: json(rec({ type: 1, pauseDuration: 120, note: "n".repeat(10) })),
      },
    ]);
    const { out, code } = await run("focus", "show", F1);
    expect(code).toBe(0);
    expect(calls.map((c) => new URL(c.url).searchParams.get("type"))).toEqual([
      "0",
      "1",
    ]);
    expect(out).toContain("type: stopwatch");
    expect(out).toContain("paused: 2m");
    expect(out).toContain(`focus delete ${F1} --type stopwatch`);
    const one = await run("focus", "show", F1, "--type", "pomo");
    expect(one.code).toBe(1);
    expect(one.out).toContain("(type pomo)");
    expect(one.out).toContain("focus --from -30d");
  });

  it("show passes other errors through", async () => {
    mockFetch([{ method: "GET", url: /./, res: json({}, 403) }]);
    expect((await run("focus", "show", F1)).out).toContain("code: FORBIDDEN");
    expect((await run("focus", "show", "../x")).code).toBe(2);
  });

  it("log previews and creates a session that just ended", async () => {
    const calls = mockFetch([
      { method: "GET", url: /\/focus\?/, res: json([]) },
      { method: "POST", url: /\/focus$/, res: json({ id: "f9", type: 0 }) },
    ]);
    const dry = await run(
      "focus",
      "log",
      "--minutes",
      "25",
      "--task",
      "a00000000000000000000001",
      "--note",
      "Draft intro",
    );
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("dry_run: nothing was sent");
    expect(dry.out).toContain('start: "2026-10-09 11:35"');
    expect(dry.out).toContain('end: "2026-10-09 12:00"');
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    const { out } = await run(
      "focus",
      "log",
      "--minutes",
      "25",
      "--task",
      "a00000000000000000000001",
      "--note",
      "Draft intro",
      "--yes",
    );
    expect(calls.at(-1)?.body).toEqual({
      type: 0,
      startTime: "2026-10-09T06:05:00+0000",
      endTime: "2026-10-09T06:30:00+0000",
      duration: 1500,
      taskId: "a00000000000000000000001",
      note: "Draft intro",
    });
    expect(out).toContain("logged:");
    expect(out).toContain("focus delete f9 --type pomo");
  });

  it("log takes --start with --end or --minutes, as a stopwatch", async () => {
    const calls = mockFetch([
      { method: "GET", url: /\/focus\?/, res: json([]) },
      { method: "POST", url: /\/focus$/, res: json(null) },
    ]);
    const { out } = await run(
      "focus",
      "log",
      "--start",
      "2026-10-09T09:00",
      "--end",
      "2026-10-09T10:30",
      "--type",
      "stopwatch",
      "--yes",
    );
    expect(calls.at(-1)?.body).toMatchObject({
      type: 1,
      startTime: "2026-10-09T03:30:00+0000",
      duration: 5400,
    });
    expect(out).toContain("id: (unknown)");
    expect(
      (
        await run(
          "focus",
          "log",
          "--start",
          "2026-10-09T09:00",
          "--minutes",
          "30",
        )
      ).out,
    ).toContain('end: "2026-10-09 09:30"');
    expect(
      (await run("focus", "log", "--minutes", "30", "--end", "now")).out,
    ).toContain('end: "2026-10-09 12:00"');
  });

  it("log refuses bad sessions", async () => {
    mockFetch([{ method: "GET", url: /\/focus\?/, res: json([]) }]);
    const bad: string[][] = [
      [],
      ["--start", "2026-10-09T09:00"],
      ["--start", "2026-10-09"],
      ["--start", "2026-10-09T09:00", "--end", "2026-10-09T08:00"],
      ["--start", "2026-10-09T09:00", "--end", "2026-10-09T13:00"],
      ["--start", "2026-10-09T09:00", "--end", "now", "--minutes", "5"],
      ["--start", "2026-10-07T09:00", "--end", "2026-10-09T10:00"],
      ["--minutes", "0"],
      ["--minutes", "5", "--task", "a/b"],
      ["--minutes", "5", "--note", "x".repeat(5001)],
      ["--minutes", "5", "--duration", "5"],
      ["stray"],
    ];
    for (const args of bad) {
      expect((await run("focus", "log", ...args)).code, args.join(" ")).toBe(2);
    }
  });

  it("log no-ops on the same session and notes overlaps", async () => {
    mockFetch([
      {
        method: "GET",
        url: /\/focus\?/,
        res: json([
          rec({
            startTime: "2026-10-09T06:05:00+0000",
            endTime: "2026-10-09T06:30:00+0000",
          }),
        ]),
      },
    ]);
    const same = await run("focus", "log", "--minutes", "25", "--yes");
    expect(same.code).toBe(0);
    expect(same.out).toContain("already logged (no-op)");
    const overlap = await run("focus", "log", "--minutes", "10");
    expect(overlap.out).toContain(`overlaps 1 logged session(s): ${F1}`);
  });

  it("delete previews, then deletes with the record's type", async () => {
    const calls = mockFetch([
      { method: "GET", url: /\/focus\/d/, res: json(rec({ type: 1 })) },
      { method: "DELETE", url: /\/focus\/d/, res: json(rec({ type: 1 })) },
    ]);
    const dry = await run("focus", "delete", F1);
    expect(dry.out).toContain("would_delete:");
    expect(dry.out).toContain("focused: 25m");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const { out, code } = await run("focus", "delete", F1, "--yes");
    expect(code).toBe(0);
    expect(calls.at(-1)?.method).toBe("DELETE");
    expect(calls.at(-1)?.url).toMatch(new RegExp(`/focus/${F1}\\?type=1$`));
    expect(out).toContain("deleted:");
  });
});

describe("countdowns", () => {
  const cds = [
    { id: "e1", name: "Mum's birthday", date: 19600312, ignoreYear: true },
    {
      id: "e2",
      name: "Anniversary",
      date: 20201015,
      repeatFlag: "RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=15",
    },
    { id: "e3", name: "Exam", date: 20261101, remark: "Hall B" },
    { id: "e4", name: "Launch", date: 20260901 },
    { id: "e5", name: "Leap", date: 20000229, ignoreYear: true },
    { id: "e6", name: "Old trip", date: 20250101 },
    { id: "e7", name: "No date" },
  ];

  it("rolls yearly dates forward and sorts by the next date", async () => {
    mockFetch([{ method: "GET", url: /\/countdown$/, res: json(cds) }]);
    const { out, code } = await run(
      "countdowns",
      "--fields",
      "date,repeat,years,remark",
    );
    expect(code).toBe(0);
    expect(out).toContain("count: 7 of 7 countdowns");
    expect(out).toContain("next_30_days: 2");
    const order = ["e2", "e3", "e5", "e1", "e4", "e6", "e7"];
    const at = order.map((id) => out.indexOf(`\n  ${id},`));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(out).toContain("e2,Anniversary,2026-10-15,6,2020-10-15,yearly,6,");
    expect(out).toContain("e5,Leap,2027-02-28,");
    expect(out).toContain(
      "e1,Mum's birthday,2027-03-12,154,1960-03-12,yearly,67,",
    );
    expect(out).toContain("e4,Launch,2026-09-01,-38,2026-09-01,none,");
    expect(out).toContain("Hall B");
  });

  it("filters with --within and says when nothing is coming up", async () => {
    mockFetch([{ method: "GET", url: /\/countdown$/, res: json(cds) }]);
    const soon = await run("countdowns", "--within", "7");
    expect(soon.out).toContain("count: 1 of 7 countdowns in the next 7 days");
    const none = await run("countdowns", "--within", "0");
    expect(none.out).toContain("0 countdowns in the next 0 days (7 in total)");
    expect((await run("countdowns", "--days", "3")).out).toContain("--within");
    expect((await run("countdowns", "--fields", "colour")).code).toBe(2);
    expect((await run("countdowns", "x")).code).toBe(2);
    mockFetch([{ method: "GET", url: /\/countdown$/, res: json({}) }]);
    expect((await run("countdowns")).out).toContain("0 countdowns found");
  });
});

describe("preferences", () => {
  const prefs = (body: unknown): Route => ({
    method: "POST",
    url: /\/preference$/,
    res: json(body),
  });

  it("matches an alias of the CLI's zone", async () => {
    const calls = mockFetch([prefs({ timeZone: "Asia/Calcutta" })]);
    const { out, code } = await run("preferences");
    expect(code).toBe(0);
    expect(calls[0].method).toBe("POST");
    expect(out).toContain("timeZone: Asia/Calcutta");
    expect(out).toContain("cli_time_zone: Asia/Kolkata (TICKTICK_AXI_TZ)");
    expect(out).toContain("time_zone_match: yes");
  });

  it("suggests TICKTICK_AXI_TZ on a mismatch", async () => {
    mockFetch([prefs({ timeZone: "America/Los_Angeles" })]);
    const { out } = await run("preferences");
    expect(out).toContain("time_zone_match: no");
    expect(out).toContain("TICKTICK_AXI_TZ=America/Los_Angeles");
  });

  it("handles odd zones and empty answers", async () => {
    mockFetch([prefs({ timeZone: "Mars/Olympus" })]);
    expect((await run("preferences")).out).toContain("unknown");
    mockFetch([prefs(null)]);
    expect((await run("preferences")).out).toContain("0 preferences returned");
    vi.stubEnv("TICKTICK_AXI_TZ", "");
    mockFetch([prefs([])]);
    expect((await run("preferences")).out).toContain("(system)");
    expect((await run("preferences", "x")).code).toBe(2);
  });
});

describe("help", () => {
  it("has --help for every new command", async () => {
    for (const cmd of [
      "habits",
      "habit",
      "focus",
      "countdowns",
      "preferences",
    ]) {
      const { out, code } = await run(cmd, "--help");
      expect(code, cmd).toBe(0);
      expect(out, cmd).toContain(`usage: ticktick-axi ${cmd}`);
    }
    expect((await run("--help")).out).toContain("habits, habit show");
  });
});
