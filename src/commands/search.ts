import {
  bool,
  expectPositionals,
  intFlag,
  listValues,
  parseArgs,
  str,
  type FlagSpec,
} from "../args.js";
import { api, FILTER_CAP, getClient, validateId, type Task } from "../api.js";
import {
  addDays,
  DATE_FORMATS,
  dateKey,
  parseUserDate,
  rangeBound,
  userTimeZone,
} from "../dates.js";
import { usage } from "../errors.js";
import { parseFields, parseStatus, taskRow } from "../format.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "./tasks.js";

const SEARCH_SPEC: FlagSpec = {
  bool: ["full"],
  value: ["status", "due-from", "due-to", "limit", "fields"],
  repeat: ["project", "tag"],
  renamed: {
    query: 'The keywords are the first argument: search "<keywords>"',
    json: "Output is always TOON; use --fields to add columns",
  },
};

export const SEARCH_HELP = `usage: ticktick-axi search "<keywords>" [flags]
Searches task titles and content with TickTick's search endpoint.
flags:
  --project <id>          only this project (repeatable)
  --tag <tag>             only tasks with this tag (repeatable)
  --status <s>            open | completed | abandoned | all (default: all)
  --due-from <date>       due on or after this date/time
  --due-to <date>         due on or before this date/time
  --limit <n>             rows to show (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})
  --fields <list>         extra columns: priority, status, tags, start, allDay, repeat, completed, kind, items, content
  --full                  do not truncate titles
dates: ${DATE_FORMATS}
examples:
  ticktick-axi search "passport"
  ticktick-axi search "report" --tag work --status open
  ticktick-axi search "rent" --due-from 2026-11-01 --due-to 2026-11-30
`;

export async function searchCommand(args: string[]) {
  const p = parseArgs(args, SEARCH_SPEC, "search");
  const [raw] = expectPositionals(p, 1, 'ticktick-axi search "<keywords>"');
  const keywords = raw.trim();
  if (!keywords) {
    throw usage(
      "Search keywords cannot be blank",
      'Run `ticktick-axi search "<keywords>"`',
    );
  }
  const tz = userTimeZone();
  const projectIds = listValues(p.multi.project ?? []);
  for (const id of projectIds) validateId(id, "project id");
  const tags = listValues(p.multi.tag ?? []);
  const statusRaw = str(p, "status");
  const status = statusRaw ? parseStatus(statusRaw) : undefined;
  const from = str(p, "due-from");
  const to = str(p, "due-to");

  const body: Parameters<typeof api.searchTasks>[1] = { keywords };
  if (projectIds.length) body.projectIds = projectIds;
  if (tags.length) body.tags = tags;
  if (status && status.name !== "all") body.status = status.codes;
  if (from) {
    body.dueFrom = rangeBound(parseUserDate(from, "--due-from", tz), tz, false);
  }
  if (to) body.dueTo = rangeBound(parseUserDate(to, "--due-to", tz), tz, true);

  const found = await api.searchTasks(getClient(), body);
  const tasks = Array.isArray(found) ? found : [];
  return list(tasks, p, tz, `tasks matching "${keywords}"`, [
    "Run `ticktick-axi task <projectId> <taskId>` for full details",
  ]);
}

const COMPLETED_SPEC: FlagSpec = {
  bool: ["full"],
  value: ["from", "to", "limit", "fields"],
  repeat: ["project"],
  renamed: {
    since: "Use --from <date>",
    until: "Use --to <date>",
    json: "Output is always TOON; use --fields to add columns",
  },
};

export const COMPLETED_HELP = `usage: ticktick-axi completed [flags]
Tasks completed in a time range (TickTick returns at most ${FILTER_CAP}), most recent first.
flags:
  --from <date>           completed on or after (default: 7 days ago)
  --to <date>             completed on or before (default: now)
  --project <id>          only this project (repeatable)
  --limit <n>             rows to show (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})
  --fields <list>         extra columns: priority, tags, due, repeat, kind, items, content
  --full                  do not truncate titles
dates: ${DATE_FORMATS}
examples:
  ticktick-axi completed
  ticktick-axi completed --from -30d --project <projectId>
`;

export async function completedCommand(args: string[]) {
  const p = parseArgs(args, COMPLETED_SPEC, "completed");
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  const tz = userTimeZone();
  const projectIds = listValues(p.multi.project ?? []);
  for (const id of projectIds) validateId(id, "project id");
  const fromRaw = str(p, "from");
  const toRaw = str(p, "to");
  const today = dateKey(Date.now(), tz);
  const from = fromRaw
    ? parseUserDate(fromRaw, "--from", tz)
    : ({ kind: "date", key: addDays(today, -7) } as const);
  const body: Parameters<typeof api.completedTasks>[1] = {
    startDate: rangeBound(from, tz, false),
  };
  if (toRaw)
    body.endDate = rangeBound(parseUserDate(toRaw, "--to", tz), tz, true);
  if (projectIds.length) body.projectIds = projectIds;

  const done = await api.completedTasks(getClient(), body);
  const tasks = (Array.isArray(done) ? done : []).sort((a, b) =>
    (b.completedTime ?? "").localeCompare(a.completedTime ?? ""),
  );
  const scope = `completed tasks${fromRaw ? "" : " in the last 7 days"}`;
  const out = list(tasks, p, tz, scope, [], ["completed"]);
  if (tasks.length >= FILTER_CAP) {
    out.note = `TickTick returns at most ${FILTER_CAP} completed tasks; narrow the range with --from/--to or --project`;
  }
  return out;
}

function list(
  tasks: Task[],
  p: ReturnType<typeof parseArgs>,
  tz: string,
  scope: string,
  help: string[],
  alwaysExtra: string[] = [],
) {
  const limit = intFlag(p, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
  const extra = [...alwaysExtra, ...parseFields(str(p, "fields"))];
  const full = bool(p, "full");
  const base = ["id", "projectId", "title", "due"];
  const rows = tasks
    .slice(0, limit)
    .map((t) => taskRow(t, { tz, base, extra, full }));
  const out: Record<string, unknown> = {};
  if (rows.length === 0) {
    out.tasks = `0 ${scope} found`;
    return out;
  }
  out.count = `${rows.length} of ${tasks.length} ${scope}`;
  out.timezone = tz;
  out.tasks = rows;
  const h = [...help];
  if (tasks.length > rows.length) {
    h.unshift(
      `Add --limit ${Math.min(tasks.length, MAX_LIMIT)} to see all ${tasks.length}`,
    );
  }
  if (h.length) out.help = h;
  return out;
}
