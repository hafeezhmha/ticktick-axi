import {
  bool,
  expectPositionals,
  intFlag,
  listValues,
  parseArgs,
  str,
  type FlagSpec,
  type ParsedArgs,
} from "../args.js";
import { getClient, validateId } from "../api.js";
import {
  apiInstant,
  apiLife,
  FOCUS_TYPES,
  focusTypeName,
  hm,
  localTime,
  validateLifeId,
  type Focus,
} from "../api-life.js";
import { AxiError, fail, goneResult, orGone, usage } from "../errors.js";
import type { TickTickClient } from "../http.js";
import {
  addDays,
  DATE_FORMATS,
  dateKey,
  formatApiDate,
  parseApiDate,
  parseUserDate,
  rangeBound,
  userTimeZone,
  type UserDate,
} from "../dates.js";
import { DETAIL_BODY_MAX, LIST_TITLE_MAX, truncate } from "../format.js";
import { confirmHint, LIFE_GATE } from "./habits.js";

const MAX_RANGE_DAYS = 90;
/** The server serves at most 30 days per query (it clamps longer ranges). */
const CHUNK_MS = 30 * 86_400_000;
const NOTE_MAX = 5000;
const MAX_SESSION_MS = 24 * 3_600_000;

export const FOCUS_HELP = `usage: ticktick-axi focus [show|log|delete] ...
focus [--from <date>] [--to <date>] [--type pomo|stopwatch|all] [--fields <list>] [--limit <n>] [--full]
    focus records (pomodoros and stopwatch sessions), newest first, with total time
    default: the last 7 days, both types; at most ${MAX_RANGE_DAYS} days per command
    --fields: end, note, taskId, pause
show <focusId> [--type pomo|stopwatch] [--full]
    one record (tries pomo, then stopwatch, unless --type is given)
log --minutes <n> | --start <date-time> [--end <date-time>|--minutes <n>] [--type] [--task <taskId>] [--note "<text>"] [--yes]
    record a finished session; --minutes alone means one that just ended. Default type pomo
delete <focusId> [--type pomo|stopwatch] [--yes]
    delete a record
log and delete are dry runs until --yes.
dates: ${DATE_FORMATS}; --end also takes now
examples:
  ticktick-axi focus
  ticktick-axi focus --from -30d --type pomo
  ticktick-axi focus log --minutes 25 --task <taskId> --note "Draft intro"
  ticktick-axi focus log --start "2026-10-14T09:00" --end "2026-10-14T10:30" --type stopwatch --yes
  ticktick-axi focus delete <focusId> --yes
`;

const focusId = (v: string) =>
  validateLifeId(v, "focus id", "ticktick-axi focus --from -30d");

function typeFlag(p: ParsedArgs, allowAll: boolean): Array<0 | 1> | undefined {
  const raw = str(p, "type");
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (allowAll && v === "all") return [0, 1];
  const alias: Record<string, 0 | 1> = {
    ...FOCUS_TYPES,
    pomodoro: 0,
    timing: 1,
    timer: 1,
    "0": 0,
    "1": 1,
  };
  if (v in alias) return [alias[v]];
  throw usage(
    `--type "${raw}" is not valid`,
    `Use pomo or stopwatch${allowAll ? " (or all)" : ""}`,
  );
}

/**
 * Focused seconds. The docs imply `duration` is seconds (1500 for 25 min), but
 * the live API ignores a sent duration and returns milliseconds computed from
 * start and end. Focused time cannot exceed the session's span, so a duration
 * larger than the span is read as milliseconds.
 */
export function focusSeconds(f: Focus): number {
  const s = apiInstant(f.startTime);
  const e = apiInstant(f.endTime);
  const span = s !== null && e !== null ? Math.max(0, (e - s) / 1000) : null;
  if (typeof f.duration === "number" && f.duration >= 0) {
    const limit = span ?? 86_400;
    return f.duration > limit + 1 ? f.duration / 1000 : f.duration;
  }
  return span === null ? 0 : Math.max(0, span - (f.pauseDuration ?? 0));
}

function taskLabel(f: Focus): string {
  const briefs = Array.isArray(f.tasks) ? f.tasks : [];
  const titles = briefs
    .map((t) => t?.title || t?.timerName || "")
    .filter(Boolean);
  if (titles.length) return [...new Set(titles)].join("; ");
  return f.taskId ?? "";
}

// ---------------------------------------------------------------- list

/** A user date as an instant: start of day, or last second for an end bound. */
function bound(ud: UserDate, tz: string, end: boolean): number {
  return (parseApiDate(rangeBound(ud, tz, end)) as Date).getTime();
}

const LIST_SPEC: FlagSpec = {
  bool: ["full"],
  value: ["from", "to", "type", "limit", "fields"],
  renamed: {
    since: "Use --from <date>",
    until: "Use --to <date>",
    days: "Use --from -<n>d, e.g. --from -30d",
    json: "Output is always TOON; use --fields to add columns",
  },
};
const FOCUS_FIELDS = ["end", "note", "taskId", "pause"];

export async function focusCommand(args: string[]) {
  const [sub, ...rest] = args;
  if (sub === "show") return showFocus(rest);
  if (sub === "log") return logFocus(rest);
  if (sub === "delete") return deleteFocus(rest);
  return listFocus(args);
}

async function listFocus(args: string[]) {
  const p = parseArgs(args, LIST_SPEC, "focus");
  if (p.positionals.length) {
    throw usage(
      `unknown focus subcommand "${p.positionals[0]}"`,
      "Use `ticktick-axi focus [--from <date>]`, or one of: show, log, delete (see `ticktick-axi focus --help`)",
    );
  }
  const fields = listValues([str(p, "fields")]);
  for (const f of fields) {
    if (!FOCUS_FIELDS.includes(f)) {
      throw usage(
        `unknown field "${f}"`,
        `Available fields: ${FOCUS_FIELDS.join(", ")}`,
      );
    }
  }
  const tz = userTimeZone();
  const now = Date.now();
  const today = dateKey(now, tz);
  const fromRaw = str(p, "from");
  const toRaw = str(p, "to");
  const fromUd = fromRaw
    ? parseUserDate(fromRaw, "--from", tz)
    : ({ kind: "date", key: addDays(today, -6) } as const);
  const toUd = toRaw
    ? parseUserDate(toRaw, "--to", tz)
    : ({ kind: "date", key: today } as const);
  const from = bound(fromUd, tz, false);
  const to = bound(toUd, tz, true);
  if (from > to) throw usage("--from is after --to");
  if (to - from > (MAX_RANGE_DAYS + 1) * 86_400_000) {
    throw usage(
      `The range is more than ${MAX_RANGE_DAYS} days`,
      `TickTick serves focus records 30 days per query; narrow --from/--to to ${MAX_RANGE_DAYS} days or less`,
    );
  }
  const types = typeFlag(p, true) ?? [0, 1];
  const limit = intFlag(p, "limit", 100, 1, 500);
  const full = bool(p, "full");
  const client = getClient();

  const seen = new Map<string, Focus>();
  for (const type of types) {
    for (let end = to; end > from; end -= CHUNK_MS) {
      const start = Math.max(from, end - CHUNK_MS);
      const raw = await apiLife.listFocus(
        client,
        formatApiDate(start),
        formatApiDate(end),
        type,
      );
      for (const f of Array.isArray(raw) ? raw : []) {
        if (f?.id && !seen.has(f.id)) seen.set(f.id, { type, ...f });
      }
    }
  }
  const records = [...seen.values()].sort(
    (a, b) => (apiInstant(b.startTime) ?? 0) - (apiInstant(a.startTime) ?? 0),
  );
  const range = `${fromRaw ? dateKey(from, tz) : `last 7 days`}${fromRaw || toRaw ? ` to ${dateKey(to, tz)}` : ""}`;
  const kind =
    types.length === 2 ? "focus records" : `${focusTypeName(types[0])} records`;
  const logHint =
    "Run `ticktick-axi focus log --minutes <n>` to preview logging a session";
  if (records.length === 0) {
    return { focus: `0 ${kind} found (${range})`, help: [logHint] };
  }
  const total = records.reduce((s, f) => s + focusSeconds(f), 0);
  const pomos = records.filter((f) => f.type !== 1).length;
  const rows = records.slice(0, limit).map((f) => {
    const row: Record<string, unknown> = {
      id: f.id,
      type: focusTypeName(f.type),
      start: localTime(f.startTime, tz),
      mins: Math.round(focusSeconds(f) / 60),
      task: full ? taskLabel(f) : truncate(taskLabel(f), LIST_TITLE_MAX).text,
    };
    for (const field of fields) {
      if (field === "end") row.end = localTime(f.endTime, tz);
      if (field === "note") {
        row.note = full
          ? (f.note ?? "")
          : truncate(f.note ?? "", LIST_TITLE_MAX).text;
      }
      if (field === "taskId") row.taskId = f.taskId ?? "";
      if (field === "pause") {
        row.pause_mins = Math.round((f.pauseDuration ?? 0) / 60);
      }
    }
    return row;
  });
  const out: Record<string, unknown> = {
    count: `${rows.length} of ${records.length} ${kind} (${range})`,
    total: `${hm(total / 60)} focused (${pomos} pomo, ${records.length - pomos} stopwatch)`,
    timezone: tz,
    focus: rows,
  };
  const help = ["Run `ticktick-axi focus show <focusId>` for one record"];
  if (records.length > rows.length) {
    help.unshift(
      `Add --limit ${Math.min(records.length, 500)} to see all ${records.length}`,
    );
  }
  help.push(logHint);
  out.help = help;
  return out;
}

// ---------------------------------------------------------------- show

/** Fetch a record, trying pomo then stopwatch when the type is unknown. */
async function findFocus(
  client: TickTickClient,
  id: string,
  types: Array<0 | 1>,
): Promise<Focus & { type: 0 | 1 }> {
  for (const type of types) {
    try {
      const f = await apiLife.getFocus(client, id, type);
      if (f && typeof f === "object" && f.id) {
        return { ...f, type: f.type === 0 || f.type === 1 ? f.type : type };
      }
    } catch (e) {
      if (!(e instanceof AxiError && e.code === "NOT_FOUND")) throw e;
    }
  }
  throw fail(
    "NOT_FOUND",
    `Not found: focus record ${id}${types.length === 1 ? ` (type ${focusTypeName(types[0])})` : ""}`,
    "Run `ticktick-axi focus --from -30d` to list focus record ids",
  );
}

function renderFocus(f: Focus, tz: string, full: boolean) {
  const out: Record<string, unknown> = {
    id: f.id,
    type: focusTypeName(f.type),
    start: localTime(f.startTime, tz),
    end: localTime(f.endTime, tz),
    focused: hm(focusSeconds(f) / 60),
  };
  if (f.pauseDuration) out.paused = hm(f.pauseDuration / 60);
  const task = taskLabel(f);
  if (task) out.task = full ? task : truncate(task, LIST_TITLE_MAX).text;
  if (f.taskId) out.taskId = f.taskId;
  if (f.note) {
    out.note = full ? f.note : truncate(f.note, DETAIL_BODY_MAX).text;
  }
  return out;
}

async function showFocus(args: string[]) {
  const p = parseArgs(args, { bool: ["full"], value: ["type"] }, "focus show");
  const [id] = expectPositionals(p, 1, "ticktick-axi focus show <focusId>");
  focusId(id);
  const tz = userTimeZone();
  const f = await findFocus(getClient(), id, typeFlag(p, false) ?? [0, 1]);
  const typeArg = focusTypeName(f.type);
  return {
    focus: renderFocus(f, tz, bool(p, "full")),
    help: [
      `Run \`ticktick-axi focus delete ${id} --type ${typeArg}\` to preview deleting it`,
    ],
  };
}

// ---------------------------------------------------------------- log

const LOG_SPEC: FlagSpec = {
  bool: ["yes"],
  value: ["start", "end", "minutes", "type", "task", "note"],
  renamed: {
    ...LIFE_GATE,
    duration: "Use --minutes <n>",
    from: "Use --start <date-time>",
    to: "Use --end <date-time>",
    project: "Only the task id is needed: --task <taskId>",
  },
};

function instantFlag(
  p: ParsedArgs,
  name: string,
  tz: string,
  now: number,
): number | undefined {
  const raw = str(p, name);
  if (raw === undefined) return undefined;
  if (name === "end" && raw.trim().toLowerCase() === "now") return now;
  const ud = parseUserDate(raw, `--${name}`, tz);
  if (ud.kind !== "datetime") {
    throw usage(
      `--${name} needs a time, not just a date`,
      'Use YYYY-MM-DDTHH:mm in your time zone, e.g. --start "2026-10-14T09:00"',
    );
  }
  return ud.instant;
}

async function logFocus(args: string[]) {
  const p = parseArgs(args, LOG_SPEC, "focus log");
  if (p.positionals.length) {
    throw usage(
      `unexpected argument "${p.positionals[0]}"`,
      'Pass the note with --note "<text>"',
    );
  }
  const tz = userTimeZone();
  const now = Date.now();
  const startFlag = instantFlag(p, "start", tz, now);
  const endFlag = instantFlag(p, "end", tz, now);
  const minutes = str(p, "minutes")
    ? intFlag(p, "minutes", 0, 1, 24 * 60)
    : undefined;
  let start: number;
  let end: number;
  if (startFlag !== undefined) {
    if (endFlag !== undefined && minutes !== undefined) {
      throw usage("Pass --end or --minutes with --start, not both");
    }
    start = startFlag;
    if (endFlag !== undefined) end = endFlag;
    else if (minutes !== undefined) end = start + minutes * 60_000;
    else {
      throw usage(
        "--start needs --end or --minutes",
        'e.g. --start "2026-10-14T09:00" --minutes 25',
      );
    }
  } else {
    if (minutes === undefined) {
      throw usage(
        "Pass --minutes <n> (a session that just ended) or --start <date-time>",
        "e.g. `ticktick-axi focus log --minutes 25`",
      );
    }
    end = endFlag ?? now;
    start = end - minutes * 60_000;
  }
  start = Math.floor(start / 1000) * 1000;
  end = Math.floor(end / 1000) * 1000;
  if (end <= start) throw usage("The session must end after it starts");
  if (end > now + 60_000) {
    throw usage(
      "The session ends in the future",
      "Log a session after it has finished",
    );
  }
  if (end - start > MAX_SESSION_MS) {
    throw usage("A session can be at most 24 hours");
  }
  const type = (typeFlag(p, false) ?? [0])[0];
  const task = str(p, "task");
  if (task !== undefined) validateId(task, "task id");
  const note = str(p, "note");
  if (note !== undefined && note.length > NOTE_MAX) {
    throw usage(`--note is ${note.length} chars; the maximum is ${NOTE_MAX}`);
  }

  const body: Record<string, unknown> = {
    type,
    startTime: formatApiDate(start),
    endTime: formatApiDate(end),
    duration: Math.round((end - start) / 1000),
  };
  if (task) body.taskId = task;
  if (note) body.note = note;

  const client = getClient();
  // Look for the same or an overlapping session before writing.
  const nearby = await apiLife.listFocus(
    client,
    formatApiDate(start - 86_400_000),
    formatApiDate(end + 86_400_000),
    type,
  );
  const overlaps = (Array.isArray(nearby) ? nearby : []).filter((f) => {
    const s = apiInstant(f?.startTime);
    const e = apiInstant(f?.endTime);
    return s !== null && e !== null && s < end && e > start;
  });
  const same = overlaps.find(
    (f) =>
      Math.abs((apiInstant(f.startTime) as number) - start) < 60_000 &&
      Math.abs((apiInstant(f.endTime) as number) - end) < 60_000,
  );
  if (same) {
    return {
      focus: {
        id: same.id,
        start: localTime(same.startTime, tz),
        result: "a session with these times is already logged (no-op)",
      },
      help: [`Run \`ticktick-axi focus show ${same.id}\` to view it`],
    };
  }
  const preview: Record<string, unknown> = {
    type: focusTypeName(type),
    start: localTime(start, tz),
    end: localTime(end, tz),
    focused: hm((end - start) / 60_000),
  };
  if (task) preview.taskId = task;
  if (note) preview.note = truncate(note, 200).text;
  const note2 = overlaps.length
    ? `overlaps ${overlaps.length} logged session(s): ${overlaps.map((f) => f.id).join(", ")}`
    : undefined;
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      would_log: preview,
      ...(note2 ? { note: note2 } : {}),
      timezone: tz,
      help: [confirmHint(["focus", "log", ...args], "log it")],
    };
  }
  const created = await apiLife.createFocus(client, body);
  const id = created?.id ?? "(unknown)";
  return {
    logged: { id, ...preview },
    help: [
      `Run \`ticktick-axi focus show ${id} --type ${focusTypeName(type)}\` to view it`,
      `Run \`ticktick-axi focus delete ${id} --type ${focusTypeName(type)}\` to preview removing it`,
    ],
  };
}

// ---------------------------------------------------------------- delete

async function deleteFocus(args: string[]) {
  const p = parseArgs(
    args,
    { bool: ["yes"], value: ["type"], renamed: LIFE_GATE },
    "focus delete",
  );
  const [id] = expectPositionals(
    p,
    1,
    "ticktick-axi focus delete <focusId> [--type pomo|stopwatch] [--yes]",
  );
  focusId(id);
  const tz = userTimeZone();
  const client = getClient();
  const f = await orGone(findFocus(client, id, typeFlag(p, false) ?? [0, 1]));
  if (!f) {
    return goneResult(
      `focus record ${id}`,
      "Run `ticktick-axi focus --from -30d` to list focus record ids",
    );
  }
  const ref = renderFocus(f, tz, false);
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      would_delete: ref,
      help: [confirmHint(["focus", "delete", ...args], "delete it")],
    };
  }
  await apiLife.deleteFocus(client, id, f.type);
  return {
    deleted: { id, type: ref.type, start: ref.start, focused: ref.focused },
    help: ["Run `ticktick-axi focus` to see the last 7 days"],
  };
}
