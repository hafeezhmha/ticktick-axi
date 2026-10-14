import { usage } from "./errors.js";

/**
 * Date handling.
 *
 * - TickTick sends and accepts `yyyy-MM-dd'T'HH:mm:ssZ`, e.g.
 *   `2019-11-13T03:00:00+0000` (responses sometimes add `.000` millis).
 * - "Today", overdue and upcoming are judged in the user's time zone:
 *   TICKTICK_AXI_TZ if set, otherwise the system time zone.
 * - All-day tasks are stored as an instant; their calendar date is read in
 *   the task's own `timeZone` (falling back to the user's), so an all-day
 *   task due "Oct 10" stays due Oct 10 regardless of where you are.
 * - Writes always send UTC (`+0000`) plus `timeZone`, which is unambiguous.
 */

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function userTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.TICKTICK_AXI_TZ;
  if (configured) {
    if (!isValidTimeZone(configured)) {
      throw usage(
        `TICKTICK_AXI_TZ "${configured}" is not a valid IANA time zone`,
        "Set it to a zone like Asia/Kolkata or America/New_York, or unset it to use the system zone",
      );
    }
    return configured;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Parse a TickTick API date string; null when absent or unparseable. */
export function parseApiDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : new Date(t);
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function wall(instant: number, tz: string): Wall {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instant))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateKey(instant: number, tz: string): string {
  const w = wall(instant, tz);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Wall-clock time (HH:mm) of an instant in a time zone. */
export function timeOfDay(instant: number, tz: string): string {
  const w = wall(instant, tz);
  return `${pad(w.hour)}:${pad(w.minute)}`;
}

function offsetMs(instant: number, tz: string): number {
  const w = wall(instant, tz);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in a zone (DST-aware). */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(guess, tz);
  const second = offsetMs(first, tz);
  return guess - second;
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d + days);
  const dt = new Date(t);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetween(fromKey: string, toKey: string): number {
  const [a, b] = [fromKey, toKey].map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86_400_000);
}

/** Format an instant as TickTick's `yyyy-MM-dd'T'HH:mm:ssZ` in UTC. */
export function formatApiDate(instant: number): string {
  const d = new Date(instant);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0000`
  );
}

/**
 * A user date as an API range bound: a plain date means the start of that day
 * (or its last second, for an end bound) in the user's zone.
 */
export function rangeBound(ud: UserDate, tz: string, end: boolean): string {
  if (ud.kind === "datetime") return formatApiDate(ud.instant);
  const key = end ? addDays(ud.key, 1) : ud.key;
  const [y, m, d] = key.split("-").map(Number);
  const start = zonedToUtc(y, m, d, 0, 0, tz);
  return formatApiDate(end ? start - 1000 : start);
}

export type UserDate =
  { kind: "date"; key: string } | { kind: "datetime"; instant: number };

export const DATE_FORMATS =
  "YYYY-MM-DD, YYYY-MM-DDTHH:mm (your time zone), an ISO time with Z/offset, today, tomorrow, yesterday, or +Nd/-Nd";

function validCalendarDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Parse a date given on the command line. */
export function parseUserDate(
  input: string,
  flag: string,
  tz: string,
  now: number = Date.now(),
): UserDate {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const today = dateKey(now, tz);
  const bad = () =>
    usage(`${flag} "${input}" is not a valid date`, `Use ${DATE_FORMATS}`);

  if (lower === "today") return { kind: "date", key: today };
  if (lower === "tomorrow") return { kind: "date", key: addDays(today, 1) };
  if (lower === "yesterday") return { kind: "date", key: addDays(today, -1) };
  const rel = /^([+-])(\d{1,3})d$/.exec(lower);
  if (rel) {
    const n = Number(rel[2]) * (rel[1] === "-" ? -1 : 1);
    return { kind: "date", key: addDays(today, n) };
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number);
    if (!validCalendarDate(y, m, d)) throw bad();
    return { kind: "date", key: raw };
  }
  const dt =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(
      raw,
    );
  if (dt) {
    const [y, m, d, h, mi] = dt.slice(1, 6).map(Number);
    const sec = dt[6] ? Number(dt[6]) : 0;
    if (!validCalendarDate(y, m, d) || h > 23 || mi > 59 || sec > 59) {
      throw bad();
    }
    if (dt[7]) {
      const zone =
        dt[7].toUpperCase() === "Z"
          ? "Z"
          : dt[7].replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
      const iso = `${raw.slice(0, 10)}T${pad(h)}:${pad(mi)}:${pad(sec)}${zone}`;
      return { kind: "datetime", instant: Date.parse(iso) };
    }
    return {
      kind: "datetime",
      instant: zonedToUtc(y, m, d, h, mi, tz) + sec * 1000,
    };
  }
  throw bad();
}

export interface DueInfo {
  /** Calendar date the task is due on. */
  key: string;
  /** "2026-10-10" for all-day, "2026-10-10 09:00" for timed (user zone). */
  display: string;
  instant: number;
  allDay: boolean;
}

export function dueInfo(
  task: { dueDate?: string; isAllDay?: boolean; timeZone?: string },
  tz: string,
): DueInfo | null {
  const d = parseApiDate(task.dueDate);
  if (!d) return null;
  const instant = d.getTime();
  if (task.isAllDay) {
    const zone =
      task.timeZone && isValidTimeZone(task.timeZone) ? task.timeZone : tz;
    const key = dateKey(instant, zone);
    return { key, display: key, instant, allDay: true };
  }
  const key = dateKey(instant, tz);
  return {
    key,
    display: `${key} ${timeOfDay(instant, tz)}`,
    instant,
    allDay: false,
  };
}

/** Same rendering for any API date field (start, completed). */
export function displayDate(
  value: string | undefined,
  allDay: boolean,
  tz: string,
  taskTz?: string,
): string | undefined {
  const info = dueInfo(
    { dueDate: value, isAllDay: allDay, timeZone: taskTz },
    tz,
  );
  return info?.display;
}

/** All-day: due before today. Timed: due time already passed. */
export function isOverdue(info: DueInfo, tz: string, now: number): boolean {
  return info.allDay ? info.key < dateKey(now, tz) : info.instant < now;
}

/** Compare a due date against a user bound; negative = before the bound. */
export function compareToBound(info: DueInfo, bound: UserDate): number {
  if (bound.kind === "date") {
    return info.key < bound.key ? -1 : info.key > bound.key ? 1 : 0;
  }
  return Math.sign(info.instant - bound.instant);
}
