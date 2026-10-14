import {
  bool,
  expectPositionals,
  intFlag,
  listValues,
  parseArgs,
  shellQuote,
  str,
  type FlagSpec,
  type ParsedArgs,
} from "../args.js";
import { getClient } from "../api.js";
import {
  apiLife,
  fromStamp,
  lastDays,
  toStamp,
  validateLifeId,
  type CheckinData,
  type Habit,
  type HabitCheckins,
  type HabitSection,
} from "../api-life.js";
import type { TickTickClient } from "../http.js";
import {
  addDays,
  DATE_FORMATS,
  dateKey,
  parseUserDate,
  userTimeZone,
} from "../dates.js";
import { fail, usage } from "../errors.js";
import { DETAIL_BODY_MAX, LIST_TITLE_MAX, truncate } from "../format.js";

/** Gate flags people guess; shared by the habit and focus writes. */
export const LIFE_GATE: Record<string, string> = {
  confirm: "--confirm is not a flag; add --yes to apply the change",
  force: "--force is not a flag; add --yes to apply the change",
  "dry-run": "Dry run is the default; omit --yes to preview",
  json: "Output is always TOON",
};

/** The exact command to rerun with --yes. */
export function confirmHint(argv: string[], verb: string): string {
  const line = ["ticktick-axi", ...argv.map(shellQuote)].join(" ");
  return `Run \`${line} --yes\` to ${verb} (only after the person confirms)`;
}

const HABIT_ID_LIST = "ticktick-axi habits --archived";
const habitId = (v: string) => validateLifeId(v, "habit id", HABIT_ID_LIST);

export const HABITS_HELP = `usage: ticktick-axi habits [--archived] [--section <id>] [--fields <list>] [--full]
Lists habits with today's check-in and the last 7 days.
today: done | <value>/<goal> <unit> (partial) | not yet | not scheduled
last_7: days done of days scheduled in the last 7 (today included)
flags:
  --archived        include archived habits
  --section <id>    only this section (ids from \`ticktick-axi habit sections\`)
  --fields <list>   extra columns: repeat, goal, section, total
  --full            do not truncate names
examples:
  ticktick-axi habits
  ticktick-axi habits --fields repeat,goal
`;

export const HABIT_HELP = `usage: ticktick-axi habit <show|sections|checkins|checkin|create|edit> ...
show <habitId> [--full]                  one habit: today, streak, the last 7 days
sections                                 habit sections (groups) with ids
checkins [<habitId> ...] [--from] [--to] check-in history (default: every active habit, last 7 days)
checkin <habitId> [--date <date>] [--value <n> | --undo] [--yes]
                                         check in for a day (default today); sets that day's value
create "<name>" [--goal <n>] [--unit <u>] [--step <n>] [--repeat <rule>]
       [--section <id>] [--color <#hex>] [--encouragement <text>] [--yes]
edit <habitId> [--name] [--goal] [--unit] [--step] [--repeat] [--section] [--color]
       [--encouragement] [--yes]
checkin, create and edit are dry runs until --yes. The Open API cannot delete a habit,
so a created habit stays until the person removes it in TickTick.
--goal other than 1 makes a numeric habit (e.g. --goal 8 --unit Glass); otherwise yes/no.
--repeat: daily (default) | weekdays | weekends | mo,we,fr | RRULE:FREQ=...
--value: the day's total for a numeric habit (default: its goal); --undo sets it to 0
dates: ${DATE_FORMATS}
examples:
  ticktick-axi habit checkin <habitId>
  ticktick-axi habit checkin <habitId> --date yesterday --yes
  ticktick-axi habit create "Read" --repeat daily
  ticktick-axi habit create "Drink water" --goal 8 --unit Glass --yes
  ticktick-axi habit checkins --from -30d
`;

// ---------------------------------------------------------------- helpers

export const isArchived = (h: Habit) =>
  (h.status ?? 0) !== 0 || h.archivedTime !== undefined;
const goalOf = (h: Habit) =>
  typeof h.goal === "number" && h.goal > 0 ? h.goal : 1;
const isNumeric = (h: Habit) =>
  (h.type ?? "Boolean").toLowerCase() !== "boolean" && goalOf(h) !== 1;

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function weekday(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Is the habit due on this day? Unknown rules count as every day. */
export function scheduledOn(rule: string | undefined, key: string): boolean {
  if (!rule) return true;
  const byday = /BYDAY=([A-Z,]+)/.exec(rule);
  if (/FREQ=WEEKLY/.test(rule) && byday) {
    return byday[1].split(",").includes(weekday(key));
  }
  return true;
}

export function repeatName(rule: string | undefined): string {
  if (!rule) return "daily";
  const r = rule.replace(/^RRULE:/, "");
  if (/^FREQ=DAILY(;INTERVAL=1)?$/.test(r)) return "daily";
  const byday = /^FREQ=WEEKLY(?:;INTERVAL=1)?;BYDAY=([A-Z,]+)$/.exec(r);
  if (byday) {
    const set = byday[1].split(",").sort().join(",");
    if (set === "FR,MO,TH,TU,WE") return "weekdays";
    if (set === "SA,SU") return "weekends";
    return `weekly ${byday[1]}`;
  }
  return r;
}

const DAY_ALIASES: Record<string, string> = {
  su: "SU",
  sun: "SU",
  mo: "MO",
  mon: "MO",
  tu: "TU",
  tue: "TU",
  we: "WE",
  wed: "WE",
  th: "TH",
  thu: "TH",
  fr: "FR",
  fri: "FR",
  sa: "SA",
  sat: "SA",
};

export function parseRepeat(input: string): string {
  const v = input.trim();
  const lower = v.toLowerCase();
  if (lower === "daily") return "RRULE:FREQ=DAILY;INTERVAL=1";
  if (lower === "weekdays") return "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
  if (lower === "weekends") return "RRULE:FREQ=WEEKLY;BYDAY=SA,SU";
  if (/^RRULE:FREQ=[A-Z]+(;[A-Z_]+=[A-Za-z0-9,_-]+)*$/.test(v)) return v;
  const parts = lower.split(",").map((s) => s.trim());
  if (parts.length && parts.every((d) => d in DAY_ALIASES)) {
    const days = DAYS.filter((d) => parts.some((p) => DAY_ALIASES[p] === d));
    return `RRULE:FREQ=WEEKLY;BYDAY=${days.join(",")}`;
  }
  throw usage(
    `--repeat "${input}" is not a valid repeat rule`,
    "Use daily, weekdays, weekends, days like mo,we,fr, or an RRULE such as RRULE:FREQ=DAILY;INTERVAL=1",
  );
}

function numFlag(
  p: ParsedArgs,
  name: string,
  min: number,
  inclusive: boolean,
): number | undefined {
  const raw = str(p, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!/^\d+(\.\d+)?$/.test(raw.trim()) || !(inclusive ? n >= min : n > min)) {
    throw usage(
      `--${name} must be a number ${inclusive ? "of at least" : "above"} ${min}, got "${raw}"`,
    );
  }
  return n;
}

function textFlag(p: ParsedArgs, name: string, max: number) {
  const raw = str(p, name);
  if (raw === undefined) return undefined;
  const v = raw.trim();
  if (!v) throw usage(`--${name} cannot be empty`);
  if (v.length > max) {
    throw usage(`--${name} is ${v.length} chars; the maximum is ${max}`);
  }
  return v;
}

function colorFlag(p: ParsedArgs) {
  const c = str(p, "color");
  if (c !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(c)) {
    throw usage(
      `--color "${c}" is not a #RRGGBB color`,
      "e.g. --color #4D8CF5",
    );
  }
  return c;
}

const fmtNum = (n: number) => String(Math.round(n * 100) / 100);

/** Per-habit map of YYYY-MM-DD -> check-in, from the checkins response. */
export function checkinMap(
  raw: unknown,
): Map<string, Map<string, CheckinData>> {
  const out = new Map<string, Map<string, CheckinData>>();
  for (const doc of Array.isArray(raw) ? (raw as HabitCheckins[]) : []) {
    if (!doc?.habitId) continue;
    const days = out.get(doc.habitId) ?? new Map<string, CheckinData>();
    for (const c of Array.isArray(doc.checkins) ? doc.checkins : []) {
      const key = fromStamp(c?.stamp);
      if (key) days.set(key, c);
    }
    out.set(doc.habitId, days);
  }
  return out;
}

export type DayState = "done" | "partial" | "none";

export function dayState(h: Habit, c: CheckinData | undefined): DayState {
  if (!c) return "none";
  const goal = typeof c.goal === "number" && c.goal > 0 ? c.goal : goalOf(h);
  const value = typeof c.value === "number" ? c.value : 0;
  if (c.status === 2 || value >= goal) return "done";
  return value > 0 ? "partial" : "none";
}

function dayLabel(
  h: Habit,
  c: CheckinData | undefined,
  key: string,
  today: string,
): string {
  const s = dayState(h, c);
  if (s === "done") return "done";
  if (s === "partial") {
    return `${fmtNum(c?.value ?? 0)}/${fmtNum(goalOf(h))}${h.unit ? ` ${h.unit}` : ""}`;
  }
  if (!scheduledOn(h.repeatRule, key)) return "not scheduled";
  return key === today ? "not yet" : "not done";
}

function lastWeek(
  h: Habit,
  days: Map<string, CheckinData> | undefined,
  keys: string[],
) {
  const scheduled = keys.filter((k) => scheduledOn(h.repeatRule, k));
  const done = keys.filter((k) => dayState(h, days?.get(k)) === "done");
  return `${done.length}/${Math.max(scheduled.length, done.length)}`;
}

/** Scheduled days done in a row, ending today (or yesterday if today is open). */
function streak(
  h: Habit,
  days: Map<string, CheckinData> | undefined,
  keys: string[],
): string {
  let n = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    const k = keys[i];
    const done = dayState(h, days?.get(k)) === "done";
    if (done) n++;
    else if (i === keys.length - 1 || !scheduledOn(h.repeatRule, k)) continue;
    else return `${n} day(s)`;
  }
  return `${n}+ day(s) (whole window)`;
}

async function fetchHabits(client: TickTickClient): Promise<Habit[]> {
  const raw = await apiLife.listHabits(client);
  return (Array.isArray(raw) ? raw : []).filter((h) => h && h.id);
}

// ---------------------------------------------------------------- habits

const HABITS_SPEC: FlagSpec = {
  bool: ["archived", "full"],
  value: ["section", "fields"],
  renamed: {
    all: "Use --archived to include archived habits",
    json: "Output is always TOON; use --fields to add columns",
  },
};
const HABIT_FIELDS = ["repeat", "goal", "section", "total"];

export async function habitsCommand(args: string[]) {
  const p = parseArgs(args, HABITS_SPEC, "habits");
  if (p.positionals.length) {
    throw usage(
      `unexpected argument "${p.positionals[0]}"`,
      "Run `ticktick-axi habit show <habitId>` for one habit",
    );
  }
  const fields = listValues([str(p, "fields")]);
  for (const f of fields) {
    if (!HABIT_FIELDS.includes(f)) {
      throw usage(
        `unknown field "${f}"`,
        `Available fields: ${HABIT_FIELDS.join(", ")}`,
      );
    }
  }
  const section = str(p, "section");
  if (section) {
    validateLifeId(section, "section id", "ticktick-axi habit sections");
  }
  const tz = userTimeZone();
  const today = dateKey(Date.now(), tz);
  const client = getClient();
  const all = await fetchHabits(client);
  const archived = all.filter(isArchived).length;
  let shown = bool(p, "archived") ? all : all.filter((h) => !isArchived(h));
  if (section) shown = shown.filter((h) => h.sectionId === section);

  const create =
    'Run `ticktick-axi habit create "<name>"` to preview adding one';
  if (shown.length === 0) {
    const hidden =
      archived && !bool(p, "archived") ? ` (${archived} archived hidden)` : "";
    return {
      habits: `0 habits found${section ? " in that section" : ""}${hidden}`,
      help: [create],
    };
  }
  const keys = lastDays(today, 7);
  const map = checkinMap(
    await apiLife.checkins(
      client,
      shown.map((h) => h.id),
      toStamp(keys[0]),
      toStamp(today),
    ),
  );
  const full = bool(p, "full");
  let doneToday = 0;
  let dueToday = 0;
  const rows = shown.map((h) => {
    const days = map.get(h.id);
    const label = dayLabel(h, days?.get(today), today, today);
    if (label === "done") doneToday++;
    if (label !== "not scheduled") dueToday++;
    const row: Record<string, unknown> = {
      id: h.id,
      name: full ? (h.name ?? "") : truncate(h.name ?? "", LIST_TITLE_MAX).text,
      today: label,
      last_7: lastWeek(h, days, keys),
    };
    if (isArchived(h) && bool(p, "archived"))
      row.name = `${row.name} (archived)`;
    for (const f of fields) {
      if (f === "repeat") row.repeat = repeatName(h.repeatRule);
      if (f === "goal") {
        row.goal = isNumeric(h)
          ? `${fmtNum(goalOf(h))}${h.unit ? ` ${h.unit}` : ""}`
          : "yes/no";
      }
      if (f === "section") row.section = h.sectionId ?? "";
      if (f === "total") row.total = h.totalCheckIns ?? 0;
    }
    return row;
  });
  const out: Record<string, unknown> = {
    count: `${rows.length} of ${all.length} habits${archived && !bool(p, "archived") ? ` (${archived} archived hidden)` : ""}`,
    today: `${today}: ${doneToday} of ${dueToday} done`,
    habits: rows,
  };
  const help = [
    "Run `ticktick-axi habit checkin <habitId>` to preview checking one in for today",
    "Run `ticktick-axi habit show <habitId>` for streak and recent days",
  ];
  if (archived && !bool(p, "archived")) {
    help.push("Run `ticktick-axi habits --archived` to include archived");
  }
  out.help = help;
  return out;
}

// ---------------------------------------------------------------- habit

const SUBS = ["show", "sections", "checkins", "checkin", "create", "edit"];

export async function habitCommand(args: string[]) {
  const [sub, ...rest] = args;
  switch (sub) {
    case "show":
      return showHabit(rest);
    case "sections":
      return sections(rest);
    case "checkins":
      return checkinsCommand(rest);
    case "checkin":
      return checkinCommand(rest);
    case "create":
      return createHabit(rest);
    case "edit":
      return editHabit(rest);
  }
  throw usage(
    sub ? `unknown habit subcommand "${sub}"` : "habit needs a subcommand",
    `Use one of: ${SUBS.join(", ")} (see \`ticktick-axi habit --help\`); \`ticktick-axi habits\` lists them`,
  );
}

const SHOW_WINDOW = 60;

async function showHabit(args: string[]) {
  const p = parseArgs(args, { bool: ["full"] }, "habit show");
  const [id] = expectPositionals(p, 1, "ticktick-axi habit show <habitId>");
  habitId(id);
  const full = bool(p, "full");
  const tz = userTimeZone();
  const today = dateKey(Date.now(), tz);
  const client = getClient();
  const h = await apiLife.getHabit(client, id);
  const keys = lastDays(today, SHOW_WINDOW);
  const days = checkinMap(
    await apiLife.checkins(client, [id], toStamp(keys[0]), toStamp(today)),
  ).get(id);

  const habit: Record<string, unknown> = {
    id: h.id ?? id,
    name: h.name ?? "",
    status: isArchived(h) ? "archived" : "active",
    kind: isNumeric(h)
      ? `numeric: goal ${fmtNum(goalOf(h))}${h.unit ? ` ${h.unit}` : ""} a day, step ${fmtNum(h.step ?? 1)}`
      : "yes/no",
    repeat: repeatName(h.repeatRule),
  };
  if (h.sectionId) habit.section = h.sectionId;
  if (typeof h.totalCheckIns === "number") {
    habit.total_check_ins = h.totalCheckIns;
  }
  if (h.reminders?.length) habit.reminders = h.reminders.join(", ");
  const help: string[] = [];
  if (h.encouragement) {
    const tr = truncate(h.encouragement, DETAIL_BODY_MAX);
    habit.encouragement = full ? h.encouragement : tr.text;
    if (tr.truncated && !full) {
      help.push(
        `Run \`ticktick-axi habit show ${id} --full\` to see everything`,
      );
    }
  }
  const week = lastDays(today, 7);
  const out: Record<string, unknown> = {
    habit,
    today: dayLabel(h, days?.get(today), today, today),
    streak: streak(h, days, keys),
    last_7: `${lastWeek(h, days, week)} scheduled days done`,
    recent: [...week].reverse().map((k) => ({
      date: k,
      state: dayLabel(h, days?.get(k), k, today),
    })),
  };
  help.push(
    `Run \`ticktick-axi habit checkin ${id}\` to preview checking in for today`,
    `Run \`ticktick-axi habit checkins ${id} --from -30d\` for the last 30 days`,
    `Run \`ticktick-axi habit edit ${id} --goal <n>\` to preview a change`,
  );
  out.help = help;
  return out;
}

async function sections(args: string[]) {
  const p = parseArgs(args, {}, "habit sections");
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  const client = getClient();
  const raw = await apiLife.habitSections(client);
  const list: HabitSection[] = (Array.isArray(raw) ? raw : []).filter(
    (s) => s && s.id,
  );
  if (list.length === 0) {
    return {
      sections: "0 habit sections found",
      help: ["Run `ticktick-axi habits` to list habits"],
    };
  }
  const habits = await fetchHabits(client);
  const active = habits.filter((h) => !isArchived(h));
  return {
    count: `${list.length} habit section(s)`,
    sections: [...list]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((s) => ({
        id: s.id,
        name: s.name ?? "",
        habits: active.filter((h) => h.sectionId === s.id).length,
      })),
    help: [
      "Run `ticktick-axi habits --section <id>` to list one section's habits",
    ],
  };
}

const CHECKINS_SPEC: FlagSpec = {
  bool: ["full"],
  value: ["from", "to", "limit"],
  renamed: {
    since: "Use --from <date>",
    until: "Use --to <date>",
    habit: "Pass habit ids as arguments: habit checkins <habitId> ...",
  },
};

function dayFlag(p: ParsedArgs, name: string, tz: string): string | undefined {
  const raw = str(p, name);
  if (raw === undefined) return undefined;
  const ud = parseUserDate(raw, `--${name}`, tz);
  return ud.kind === "date" ? ud.key : dateKey(ud.instant, tz);
}

async function checkinsCommand(args: string[]) {
  const p = parseArgs(args, CHECKINS_SPEC, "habit checkins");
  const ids = [...new Set(p.positionals)];
  for (const id of ids) habitId(id);
  const tz = userTimeZone();
  const today = dateKey(Date.now(), tz);
  const to = dayFlag(p, "to", tz) ?? today;
  const from = dayFlag(p, "from", tz) ?? addDays(to, -6);
  if (from > to) {
    throw usage(`--from ${from} is after --to ${to}`);
  }
  const limit = intFlag(p, "limit", 100, 1, 1000);
  const full = bool(p, "full");
  const client = getClient();
  const habits = await fetchHabits(client);
  const byId = new Map(habits.map((h) => [h.id, h]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) {
    throw fail(
      "NOT_FOUND",
      `No habit ${unknown.join(", ")}`,
      `Run \`${HABIT_ID_LIST}\` to list habit ids`,
    );
  }
  const target = ids.length
    ? ids.map((id) => byId.get(id) as Habit)
    : habits.filter((h) => !isArchived(h));
  if (target.length === 0) {
    return {
      checkins: "0 habits found",
      help: ['Run `ticktick-axi habit create "<name>"` to preview adding one'],
    };
  }
  const map = checkinMap(
    await apiLife.checkins(
      client,
      target.map((h) => h.id),
      toStamp(from),
      toStamp(to),
    ),
  );
  const rows: Array<Record<string, unknown>> = [];
  for (const h of target) {
    for (const [key, c] of map.get(h.id) ?? []) {
      if (key < from || key > to) continue;
      const state = dayState(h, c);
      rows.push({
        date: key,
        habitId: h.id,
        name: full
          ? (h.name ?? "")
          : truncate(h.name ?? "", LIST_TITLE_MAX).text,
        value: `${fmtNum(c.value ?? 0)}/${fmtNum(c.goal ?? goalOf(h))}`,
        state: state === "none" ? "not done" : state,
      });
    }
  }
  rows.sort(
    (a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      String(a.name).localeCompare(String(b.name)),
  );
  const range = from === to ? from : `${from} to ${to}`;
  if (rows.length === 0) {
    return {
      checkins: `0 check-ins ${range} for ${target.length} habit(s)`,
      help: [
        "Run `ticktick-axi habit checkin <habitId>` to preview checking one in",
      ],
    };
  }
  const done = rows.filter((r) => r.state === "done").length;
  const shown = rows.slice(0, limit);
  const out: Record<string, unknown> = {
    count: `${shown.length} of ${rows.length} check-ins ${range} (${done} done) for ${target.length} habit(s)`,
    checkins: shown,
  };
  if (rows.length > shown.length) {
    out.help = [
      `Add --limit ${Math.min(rows.length, 1000)} to see all ${rows.length}`,
    ];
  }
  return out;
}

const CHECKIN_SPEC: FlagSpec = {
  bool: ["yes", "undo"],
  value: ["date", "value"],
  renamed: {
    ...LIFE_GATE,
    stamp: "Use --date <date>",
    day: "Use --date <date>",
  },
};

async function checkinCommand(args: string[]) {
  const p = parseArgs(args, CHECKIN_SPEC, "habit checkin");
  const [id] = expectPositionals(
    p,
    1,
    "ticktick-axi habit checkin <habitId> [--date <date>] [--value <n> | --undo] [--yes]",
  );
  habitId(id);
  const tz = userTimeZone();
  const today = dateKey(Date.now(), tz);
  const day = dayFlag(p, "date", tz) ?? today;
  if (day > today) {
    throw usage(
      `--date ${day} is in the future`,
      "Check in for today or an earlier day",
    );
  }
  const undo = bool(p, "undo");
  const valueFlag = numFlag(p, "value", 0, true);
  if (undo && valueFlag !== undefined) {
    throw usage("--value and --undo cannot be combined");
  }
  const client = getClient();
  const h = await apiLife.getHabit(client, id);
  const goal = goalOf(h);
  if (!isNumeric(h) && valueFlag !== undefined && valueFlag > 1) {
    throw usage(
      `This is a yes/no habit; --value ${valueFlag} has no meaning`,
      `Run \`ticktick-axi habit checkin ${id}\` (done) or add --undo`,
    );
  }
  const value = undo ? 0 : (valueFlag ?? goal);
  const stamp = toStamp(day);
  const current = checkinMap(await apiLife.checkins(client, [id], stamp, stamp))
    .get(id)
    ?.get(day);
  const describe = (c: CheckinData | undefined) => {
    if (!c) return "no check-in";
    const s = dayState(h, c);
    return `${s === "none" ? "not done" : s} (${fmtNum(c.value ?? 0)}/${fmtNum(c.goal ?? goal)})`;
  };
  const after: CheckinData = { value, goal };
  const ref = { id, name: h.name ?? "" };
  if (current && (current.value ?? 0) === value) {
    return {
      habit: ref,
      result: `${day} is already ${describe(current)} (no-op)`,
    };
  }
  if (!current && value === 0) {
    return { habit: ref, result: `${day} has no check-in to undo (no-op)` };
  }
  const change = `${day}: ${describe(current)} -> ${describe(after)}`;
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      habit: ref,
      would_change: change,
      help: [confirmHint(["habit", "checkin", ...args], "check in")],
    };
  }
  const res = await apiLife.checkin(client, id, { stamp, value, goal });
  const saved = checkinMap(Array.isArray(res) ? res : res ? [res] : [])
    .get(id)
    ?.get(day);
  const out: Record<string, unknown> = {
    checked_in: ref,
    change,
  };
  if (saved && (saved.value ?? 0) !== value) {
    out.note = `TickTick reports ${describe(saved)} for ${day}`;
  }
  out.help = [
    `Run \`ticktick-axi habit show ${id}\` to see the streak`,
    "Run `ticktick-axi habits` for today's other habits",
  ];
  return out;
}

const HABIT_WRITE_VALUE = [
  "goal",
  "unit",
  "step",
  "repeat",
  "section",
  "color",
  "encouragement",
];

interface HabitInput {
  goal?: number;
  unit?: string;
  step?: number;
  repeatRule?: string;
  sectionId?: string;
  color?: string;
  encouragement?: string;
}

function habitInput(p: ParsedArgs): HabitInput {
  const repeat = str(p, "repeat");
  const section = str(p, "section");
  if (section) {
    validateLifeId(section, "section id", "ticktick-axi habit sections");
  }
  const input: HabitInput = {
    goal: numFlag(p, "goal", 0, false),
    unit: textFlag(p, "unit", 50),
    step: numFlag(p, "step", 0, false),
    repeatRule: repeat !== undefined ? parseRepeat(repeat) : undefined,
    sectionId: section,
    color: colorFlag(p),
    encouragement: textFlag(p, "encouragement", 1000),
  };
  return input;
}

/** Section name for previews; errors when the id is not one of theirs. */
async function sectionName(
  client: TickTickClient,
  id: string,
): Promise<string> {
  const raw = await apiLife.habitSections(client);
  const s = (Array.isArray(raw) ? raw : []).find((x) => x?.id === id);
  if (!s) {
    throw fail(
      "NOT_FOUND",
      `No habit section ${id}`,
      "Run `ticktick-axi habit sections` to list section ids",
    );
  }
  return s.name ?? id;
}

async function createHabit(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes"],
      value: HABIT_WRITE_VALUE,
      renamed: {
        ...LIFE_GATE,
        name: 'The name is the first argument: habit create "<name>"',
        type: "The type follows --goal: a goal other than 1 makes a numeric habit",
      },
    },
    "habit create",
  );
  const [rawName] = expectPositionals(
    p,
    1,
    'ticktick-axi habit create "<name>" [--goal <n>] [--repeat <rule>] [--yes]',
  );
  const name = rawName.trim();
  if (!name) throw usage("The habit name cannot be empty");
  if (name.length > 1000) {
    throw usage(`The name is ${name.length} chars; the maximum is 1000`);
  }
  const input = habitInput(p);
  const goal = input.goal ?? 1;
  const body: Record<string, unknown> = {
    name,
    type: goal === 1 ? "Boolean" : "Real",
    goal,
    step: input.step ?? 1,
    unit: input.unit ?? "Count",
    repeatRule: input.repeatRule ?? "RRULE:FREQ=DAILY;INTERVAL=1",
  };
  if (input.sectionId) body.sectionId = input.sectionId;
  if (input.color) body.color = input.color;
  if (input.encouragement) body.encouragement = input.encouragement;

  const client = getClient();
  const existing = (await fetchHabits(client)).find(
    (h) => (h.name ?? "").trim().toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return {
      habit: {
        id: existing.id,
        name: existing.name ?? "",
        result: "a habit with this name already exists (no-op)",
      },
      help: [
        `Run \`ticktick-axi habit show ${existing.id}\` to view it`,
        `Run \`ticktick-axi habit edit ${existing.id} --goal <n>\` to preview changing it`,
      ],
    };
  }
  const preview: Record<string, unknown> = {
    name,
    kind:
      body.type === "Real"
        ? `numeric: goal ${fmtNum(goal)} ${body.unit as string} a day, step ${fmtNum(body.step as number)}`
        : "yes/no",
    repeat: repeatName(body.repeatRule as string),
  };
  if (input.sectionId) {
    preview.section = await sectionName(client, input.sectionId);
  }
  if (input.color) preview.color = input.color;
  if (input.encouragement) {
    preview.encouragement = truncate(input.encouragement, 200).text;
  }
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      would_create: preview,
      note: "the Open API cannot delete habits; only the person can remove one in TickTick",
      help: [confirmHint(["habit", "create", ...args], "create it")],
    };
  }
  const created = await apiLife.createHabit(client, body);
  const id = created?.id ?? "(unknown)";
  return {
    created: { id, ...preview, name: created?.name ?? name },
    help: [
      `Run \`ticktick-axi habit checkin ${id}\` to preview checking in for today`,
      "Run `ticktick-axi habits` to see all habits",
    ],
  };
}

async function editHabit(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes"],
      value: ["name", ...HABIT_WRITE_VALUE],
      renamed: {
        ...LIFE_GATE,
        title: "Use --name <text>",
        type: "The type follows --goal: a goal other than 1 makes a numeric habit",
        archive:
          "The Open API documents no archive values for habits; archive it in TickTick",
      },
    },
    "habit edit",
  );
  const [id] = expectPositionals(
    p,
    1,
    "ticktick-axi habit edit <habitId> [--name ...] [--goal ...] [--yes]",
  );
  habitId(id);
  const name = textFlag(p, "name", 1000);
  const input = habitInput(p);
  const given = Object.values(input).some((v) => v !== undefined);
  if (name === undefined && !given) {
    throw usage(
      "Nothing to change",
      "Pass at least one of --name, --goal, --unit, --step, --repeat, --section, --color, --encouragement",
    );
  }
  const client = getClient();
  const h = await apiLife.getHabit(client, id);
  const changes: Array<{ field: string; from: string; to: string }> = [];
  const body: Record<string, unknown> = {};
  const diff = (
    field: string,
    key: keyof Habit,
    want: unknown,
    show: (v: unknown) => string = (v) =>
      v === undefined ? "none" : String(v),
  ) => {
    if (want === undefined || want === h[key]) return;
    changes.push({ field, from: show(h[key]), to: show(want) });
    body[key] = want;
  };
  diff("name", "name", name);
  diff("goal", "goal", input.goal, (v) =>
    v === undefined ? "1" : fmtNum(v as number),
  );
  if (input.goal !== undefined) {
    const type = input.goal === 1 ? "Boolean" : "Real";
    if ((h.type ?? "Boolean") !== type) {
      changes.push({
        field: "kind",
        from: isNumeric(h) ? "numeric" : "yes/no",
        to: type === "Real" ? "numeric" : "yes/no",
      });
      body.type = type;
    }
  }
  diff("unit", "unit", input.unit);
  diff("step", "step", input.step);
  diff("repeat", "repeatRule", input.repeatRule, (v) =>
    repeatName(v as string | undefined),
  );
  if (input.sectionId !== undefined && input.sectionId !== h.sectionId) {
    const to = await sectionName(client, input.sectionId);
    changes.push({ field: "section", from: h.sectionId ?? "none", to });
    body.sectionId = input.sectionId;
  }
  diff("color", "color", input.color);
  diff("encouragement", "encouragement", input.encouragement, (v) =>
    v === undefined ? "none" : truncate(String(v), 80).text,
  );

  const ref = { id, name: h.name ?? "" };
  if (changes.length === 0) {
    return { habit: { ...ref, result: "no changes (already as requested)" } };
  }
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      habit: ref,
      changes,
      help: [confirmHint(["habit", "edit", ...args], "apply it")],
    };
  }
  const updated = await apiLife.updateHabit(client, id, body);
  return {
    updated: { ...ref, name: updated?.name ?? name ?? ref.name },
    changes,
    help: [`Run \`ticktick-axi habit show ${id}\` to view it`],
  };
}
