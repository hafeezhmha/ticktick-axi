import { validateId } from "./api.js";
import { addDays, dateKey, parseApiDate, timeOfDay } from "./dates.js";
import { AxiError, fail, usage } from "./errors.js";
import type { TickTickClient } from "./http.js";

/**
 * Habits, focus records, countdowns and user preferences: the Open API's
 * "life" endpoints. Same style as `api` in api.ts: one function per
 * documented endpoint, reads marked retry-safe, writes never retried.
 */

/** Documented as a date string; the live API sends some times as epoch ms. */
export type ApiTime = string | number;

/** Fields of the Open API `OpenHabit` definition this CLI reads. */
export interface Habit {
  id: string;
  name?: string;
  color?: string;
  status?: number;
  encouragement?: string;
  totalCheckIns?: number;
  archivedTime?: ApiTime;
  type?: string;
  goal?: number;
  step?: number;
  unit?: string;
  repeatRule?: string;
  reminders?: string[];
  sectionId?: string;
  targetDays?: number;
  targetStartDate?: number;
  completedCycles?: number;
}

/** `OpenHabitSection`. */
export interface HabitSection {
  id: string;
  name?: string;
  sortOrder?: number;
}

/** `OpenHabitCheckinData`: one day's check-in. */
export interface CheckinData {
  id?: string;
  stamp?: number;
  time?: ApiTime;
  opTime?: ApiTime;
  value?: number;
  goal?: number;
  status?: number;
}

/** `OpenHabitCheckin`: a habit's check-ins for one year. */
export interface HabitCheckins {
  id?: string;
  habitId?: string;
  year?: number;
  checkins?: CheckinData[];
}

/** `OpenPomodoroTaskBrief`. */
export interface FocusTaskBrief {
  taskId?: string;
  title?: string;
  habitId?: string;
  timerId?: string;
  timerName?: string;
  startTime?: ApiTime;
  endTime?: ApiTime;
}

/** `OpenFocus`. */
export interface Focus {
  id: string;
  type?: number;
  taskId?: string;
  note?: string;
  tasks?: FocusTaskBrief[];
  status?: number;
  startTime?: ApiTime;
  endTime?: ApiTime;
  pauseDuration?: number;
  adjustTime?: number;
  createdTime?: ApiTime;
  duration?: number;
}

/** `OpenCountdown`. */
export interface Countdown {
  id: string;
  type?: number;
  name?: string;
  date?: number;
  color?: string;
  ignoreYear?: boolean;
  repeatFlag?: string;
  remark?: string;
  status?: number;
}

/** Focus type: Pomodoro `0`, Timing (stopwatch) `1`. */
export const FOCUS_TYPES: Record<string, 0 | 1> = { pomo: 0, stopwatch: 1 };
export const focusTypeName = (t: number | undefined) =>
  t === 1 ? "stopwatch" : "pomo";

/** Validate an id with a pointer to the command that lists them. */
export function validateLifeId(
  value: string,
  label: string,
  list: string,
): string {
  try {
    return validateId(value, label);
  } catch {
    throw usage(`invalid ${label} "${value}"`, `Run \`${list}\` to list ids`);
  }
}

/** Rethrow a 404 with a hint that fits the resource instead of tasks. */
async function withHint<T>(p: Promise<T>, ...help: string[]): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AxiError && e.code === "NOT_FOUND") {
      throw fail("NOT_FOUND", e.message, ...help);
    }
    throw e;
  }
}

const enc = encodeURIComponent;
const query = (params: Record<string, string | number>) =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${enc(String(v))}`)
    .join("&");

const HABITS_HINT = "Run `ticktick-axi habits --archived` to list habit ids";
const FOCUS_HINT =
  "Run `ticktick-axi focus --from -30d` to list focus record ids";

export const apiLife = {
  listHabits: (c: TickTickClient) =>
    c.request<Habit[]>("GET", "/habit", { read: true }),

  getHabit: (c: TickTickClient, habitId: string) =>
    withHint(
      c.request<Habit>("GET", `/habit/${enc(habitId)}`, {
        read: true,
        what: `habit ${habitId}`,
      }),
      HABITS_HINT,
    ),

  habitSections: (c: TickTickClient) =>
    c.request<HabitSection[]>("GET", "/habit/sections", { read: true }),

  createHabit: (c: TickTickClient, body: Record<string, unknown>) =>
    c.request<Habit>("POST", "/habit", { body, read: false }),

  updateHabit: (
    c: TickTickClient,
    habitId: string,
    body: Record<string, unknown>,
  ) =>
    withHint(
      c.request<Habit>("POST", `/habit/${enc(habitId)}`, {
        body,
        read: false,
        what: `habit ${habitId}`,
      }),
      HABITS_HINT,
    ),

  /** Creates or replaces one day's check-in (value is set, not added). */
  checkin: (
    c: TickTickClient,
    habitId: string,
    body: { stamp: number; value: number; goal: number },
  ) =>
    withHint(
      c.request<HabitCheckins>("POST", `/habit/${enc(habitId)}/checkin`, {
        body,
        read: false,
        what: `habit ${habitId}`,
      }),
      HABITS_HINT,
    ),

  /** `from`/`to` are YYYYMMDD stamps, both inclusive. */
  checkins: (c: TickTickClient, habitIds: string[], from: number, to: number) =>
    c.request<HabitCheckins[]>(
      "GET",
      `/habit/checkins?${query({ habitIds: habitIds.join(","), from, to })}`,
      { read: true },
    ),

  getFocus: (c: TickTickClient, focusId: string, type: 0 | 1) =>
    withHint(
      c.request<Focus>("GET", `/focus/${enc(focusId)}?${query({ type })}`, {
        read: true,
        what: `${focusTypeName(type)} focus record ${focusId}`,
      }),
      FOCUS_HINT,
    ),

  /** The server clamps a range longer than 30 days to the 30 days before `to`. */
  listFocus: (c: TickTickClient, from: string, to: string, type: 0 | 1) =>
    c.request<Focus[]>("GET", `/focus?${query({ from, to, type })}`, {
      read: true,
    }),

  createFocus: (c: TickTickClient, body: Record<string, unknown>) =>
    c.request<Focus>("POST", "/focus", { body, read: false }),

  deleteFocus: (c: TickTickClient, focusId: string, type: 0 | 1) =>
    withHint(
      c.request<Focus>("DELETE", `/focus/${enc(focusId)}?${query({ type })}`, {
        read: false,
        what: `${focusTypeName(type)} focus record ${focusId}`,
      }),
      FOCUS_HINT,
    ),

  listCountdowns: (c: TickTickClient) =>
    c.request<Countdown[]>("GET", "/countdown", { read: true }),

  /** POST /preference only reads (documented as "Get User Preferences"). */
  preferences: (c: TickTickClient) =>
    c.request<Record<string, unknown>>("POST", "/preference", { read: true }),
};

/** A calendar date key (YYYY-MM-DD) as a TickTick `YYYYMMDD` stamp. */
export function toStamp(key: string): number {
  return Number(key.replace(/-/g, ""));
}

/** A `YYYYMMDD` stamp (number or string) as YYYY-MM-DD; "" if malformed. */
export function fromStamp(stamp: unknown): string {
  const s = String(stamp ?? "");
  if (!/^\d{8}$/.test(s)) return "";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Instant (ms) of an API time sent as a date string or epoch ms. */
export function apiInstant(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseApiDate(v)?.getTime() ?? null;
  return null;
}

/** "2026-10-09 16:00" in the user's zone, or "" when absent. */
export function localTime(v: unknown, tz: string): string {
  const t = apiInstant(v);
  return t === null ? "" : `${dateKey(t, tz)} ${timeOfDay(t, tz)}`;
}

/** The `count` most recent date keys ending at `end`, oldest first. */
export function lastDays(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));
}

/** Whole minutes as "1h 05m" / "25m". */
export function hm(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
