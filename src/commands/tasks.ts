import {
  bool,
  intFlag,
  listValues,
  parseArgs,
  shellQuote,
  str,
  type FlagSpec,
} from "../args.js";
import { getClient } from "../api.js";
import { DATE_FORMATS, parseUserDate, userTimeZone } from "../dates.js";
import { usage } from "../errors.js";
import { parseFields, parsePriority, parseStatus, taskRow } from "../format.js";
import {
  applyDueFilters,
  fetchTasks,
  sortTasks,
  type TaskQuery,
} from "../query.js";

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

const COMMON_VALUE = ["project", "priority", "limit", "fields"];
const COMMON_REPEAT = ["tag"];
const RENAMED: Record<string, string> = {
  list: "--list is not a flag; use --project <id> (see `ticktick-axi projects`)",
  state: "--state is not a flag; use --status open|completed|abandoned|all",
  due: "--due is not a filter; use --due-before <date>, --due-after <date>, --overdue or --upcoming <days>",
  json: "Output is always TOON; use --fields to add columns",
};

export const TASKS_SPEC: FlagSpec = {
  bool: ["overdue", "full"],
  value: [...COMMON_VALUE, "status", "due-before", "due-after", "upcoming"],
  repeat: COMMON_REPEAT,
  renamed: { ...RENAMED, days: "use --upcoming <days>" },
};

const OVERDUE_SPEC: FlagSpec = {
  bool: ["full"],
  value: COMMON_VALUE,
  repeat: COMMON_REPEAT,
  renamed: RENAMED,
};

const UPCOMING_SPEC: FlagSpec = {
  bool: ["full"],
  value: [...COMMON_VALUE, "days"],
  repeat: COMMON_REPEAT,
  renamed: RENAMED,
};

export const TASKS_HELP = `usage: ticktick-axi tasks [flags]
Lists tasks across all projects (or one), soonest due first.
flags:
  --project <id>          one project (ids from \`ticktick-axi projects\`); \`inbox\` for the Inbox
  --status <s>            open (default) | completed | abandoned | all
  --due-before <date>     due strictly before this date/time
  --due-after <date>      due strictly after this date/time
  --overdue               open tasks whose due date/time has passed
  --upcoming <days>       open tasks due from now through today+<days>
  --priority <p>          none | low | medium | high (comma-separated for several)
  --tag <tag>             only tasks with this tag (repeatable; all must match)
  --limit <n>             rows to show (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})
  --fields <list>         extra columns: projectId, priority, status, tags, start, allDay, repeat, completed, kind, items, content
  --full                  do not truncate titles
dates: ${DATE_FORMATS}
notes: cross-project queries use TickTick's filter endpoint, which returns at most 200 tasks;
  due-date filters are applied locally in your time zone (TICKTICK_AXI_TZ or the system zone).
examples:
  ticktick-axi tasks
  ticktick-axi tasks --project <projectId> --priority high
  ticktick-axi tasks --due-before 2026-11-01 --fields priority,tags
  ticktick-axi tasks --status completed --project <projectId>
`;

export const OVERDUE_HELP = `usage: ticktick-axi overdue [flags]
Open tasks whose due date (all-day) or due time (timed) has passed.
flags:
  --project <id>, --priority <p>, --tag <tag>, --limit <n>, --fields <list>, --full
examples:
  ticktick-axi overdue
  ticktick-axi overdue --project <projectId> --fields priority
`;

export const UPCOMING_HELP = `usage: ticktick-axi upcoming [flags]
Open tasks due from now through the next <days> days (not overdue ones).
flags:
  --days <n>              window in days after today (default 7, max 365)
  --project <id>, --priority <p>, --tag <tag>, --limit <n>, --fields <list>, --full
examples:
  ticktick-axi upcoming
  ticktick-axi upcoming --days 14 --priority high
`;

export async function tasksCommand(args: string[]) {
  const p = parseArgs(args, TASKS_SPEC, "tasks");
  if (p.positionals.length > 0) {
    throw usage(
      `unexpected argument "${p.positionals[0]}"`,
      "Run `ticktick-axi task <projectId> <taskId>` to view one task",
    );
  }
  const tz = userTimeZone();
  const status = parseStatus(str(p, "status") ?? "open");
  const overdue = bool(p, "overdue");
  const upcomingRaw = str(p, "upcoming");
  if (overdue && upcomingRaw !== undefined) {
    throw usage("--overdue and --upcoming cannot be combined");
  }
  if ((overdue || upcomingRaw !== undefined) && status.name !== "open") {
    throw usage("--overdue and --upcoming only apply to --status open");
  }
  const q: TaskQuery = {
    ...common(p),
    statusName: status.name,
    statusCodes: status.codes,
    overdue,
    upcomingDays:
      upcomingRaw === undefined ? undefined : intFlag(p, "upcoming", 7, 0, 365),
  };
  const before = str(p, "due-before");
  const after = str(p, "due-after");
  if (before) q.dueBefore = parseUserDate(before, "--due-before", tz);
  if (after) q.dueAfter = parseUserDate(after, "--due-after", tz);
  return runList(q, p, tz, "tasks", args);
}

export async function overdueCommand(args: string[]) {
  const p = parseArgs(args, OVERDUE_SPEC, "overdue");
  noPositionals(p.positionals, "overdue");
  const tz = userTimeZone();
  const q: TaskQuery = {
    ...common(p),
    statusName: "open",
    statusCodes: [0],
    overdue: true,
  };
  return runList(q, p, tz, "overdue", args);
}

export async function upcomingCommand(args: string[]) {
  const p = parseArgs(args, UPCOMING_SPEC, "upcoming");
  noPositionals(p.positionals, "upcoming");
  const tz = userTimeZone();
  const q: TaskQuery = {
    ...common(p),
    statusName: "open",
    statusCodes: [0],
    upcomingDays: intFlag(p, "days", 7, 0, 365),
  };
  return runList(q, p, tz, "upcoming", args);
}

function noPositionals(positionals: string[], command: string) {
  if (positionals.length > 0) {
    throw usage(
      `unexpected argument "${positionals[0]}"`,
      `Run \`ticktick-axi ${command} --help\` for flags`,
    );
  }
}

function common(p: ReturnType<typeof parseArgs>) {
  const priorityRaw = str(p, "priority");
  const priority = priorityRaw
    ? listValues([priorityRaw]).map((v) => parsePriority(v))
    : undefined;
  const tags = listValues(p.multi.tag ?? []);
  return {
    projectId: str(p, "project"),
    priority,
    tags: tags.length ? tags : undefined,
  };
}

async function runList(
  q: TaskQuery,
  p: ReturnType<typeof parseArgs>,
  tz: string,
  command: string,
  rawArgs: string[],
) {
  const limit = intFlag(p, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
  const extra = parseFields(str(p, "fields"));
  const full = bool(p, "full");
  const client = getClient();
  const now = Date.now();
  const { tasks, capped } = await fetchTasks(client, q);
  const matching = sortTasks(applyDueFilters(tasks, q, tz, now), tz);
  const shown = matching.slice(0, limit);
  const pid =
    q.projectId && q.projectId !== "inbox" ? q.projectId : "<projectId>";
  const base =
    pid === "<projectId>"
      ? ["id", "projectId", "title", "due"]
      : ["id", "title", "due", "priority"];
  const rows = shown.map((t) => taskRow(t, { tz, base, extra, full }));

  const scope = describe(q);
  const out: Record<string, unknown> = {};
  if (rows.length === 0) {
    out[command === "tasks" ? "tasks" : command] = `0 ${scope} found`;
    if (capped) out.note = capNote();
    out.help = emptyHelp(q, command);
    return out;
  }
  out.count = `${rows.length} of ${matching.length} ${scope}`;
  out.timezone = tz;
  out.tasks = rows;
  if (capped) out.note = capNote();
  const help = [
    `Run \`ticktick-axi task ${pid} <taskId>\` for full details`,
    `Run \`ticktick-axi complete ${pid} <taskId>\` to preview completing one`,
  ];
  if (matching.length > rows.length) {
    help.unshift(
      `Run \`ticktick-axi ${[command, ...withoutLimit(rawArgs)].map(shellQuote).join(" ")} --limit ${Math.min(matching.length, MAX_LIMIT)}\` to see all ${matching.length}`,
    );
  }
  out.help = help;
  return out;
}

function withoutLimit(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") {
      i++;
      continue;
    }
    if (args[i].startsWith("--limit=")) continue;
    out.push(args[i]);
  }
  return out;
}

function capNote(): string {
  return "TickTick's filter endpoint returns at most 200 tasks, so this list may be incomplete; narrow it with --project, --priority or --tag";
}

function describe(q: TaskQuery): string {
  const parts = [
    q.overdue ? "overdue" : "",
    q.statusName === "all" ? "" : q.statusName,
    "tasks",
  ].filter(Boolean);
  if (q.upcomingDays !== undefined) {
    parts.push(`due in the next ${q.upcomingDays} days`);
  }
  if (q.dueBefore) parts.push("due before the given date");
  if (q.dueAfter) parts.push("due after the given date");
  if (q.priority?.length) parts.push("with the given priority");
  if (q.tags?.length) parts.push(`tagged ${q.tags.join(", ")}`);
  if (q.projectId) {
    parts.push(
      q.projectId === "inbox" ? "in the Inbox" : `in project ${q.projectId}`,
    );
  }
  return parts.join(" ");
}

function emptyHelp(q: TaskQuery, command: string): string[] {
  const help: string[] = [];
  if (q.projectId && q.projectId !== "inbox") {
    help.push(
      `Run \`ticktick-axi create "<title>" --project ${q.projectId}\` to preview adding a task`,
    );
  } else {
    help.push(
      'Run `ticktick-axi create "<title>" --project <projectId>` to preview adding a task',
    );
  }
  if (command !== "tasks" || q.overdue || q.upcomingDays !== undefined) {
    help.push("Run `ticktick-axi tasks` to list all open tasks");
  }
  return help;
}
