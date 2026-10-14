import {
  bool,
  intFlag,
  listValues,
  parseArgs,
  str,
  type FlagSpec,
} from "../args.js";
import { getClient } from "../api.js";
import { apiLife, fromStamp, type Countdown } from "../api-life.js";
import { dateKey, daysBetween, userTimeZone } from "../dates.js";
import { usage } from "../errors.js";
import { LIST_TITLE_MAX, truncate } from "../format.js";

export const COUNTDOWNS_HELP = `usage: ticktick-axi countdowns [--within <days>] [--fields <list>] [--full]
Lists countdowns (birthdays, anniversaries, events) by the next date, soonest first.
next: the coming date (yearly ones roll over to next year); days: days from today to it
(0 = today, negative = a one-off date that has passed).
Read-only: the Open API documents no countdown writes; change them in TickTick.
flags:
  --within <days>   only those coming up in the next <days> days
  --fields <list>   extra columns: date, repeat, years, remark
  --full            do not truncate names and remarks
examples:
  ticktick-axi countdowns
  ticktick-axi countdowns --within 30 --fields years
`;

const SPEC: FlagSpec = {
  bool: ["full"],
  value: ["within", "fields"],
  renamed: {
    days: "Use --within <days>",
    json: "Output is always TOON; use --fields to add columns",
  },
};
const FIELDS = ["date", "repeat", "years", "remark"];

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function onYear(year: number, md: string): string {
  if (md === "02-29" && !isLeap(year)) return `${year}-02-28`;
  return `${year}-${md}`;
}

export interface Occurrence {
  date: string;
  next: string;
  days: number;
  yearly: boolean;
}

/** The next date a countdown lands on, rolling yearly ones forward. */
export function nextOccurrence(c: Countdown, today: string): Occurrence | null {
  const date = fromStamp(c.date);
  if (!date) return null;
  const yearly = !!c.ignoreYear || /FREQ=YEARLY/.test(c.repeatFlag ?? "");
  if (!yearly) {
    return { date, next: date, days: daysBetween(today, date), yearly };
  }
  const md = date.slice(5);
  const year = Number(today.slice(0, 4));
  let next = onYear(year, md);
  if (next < today) next = onYear(year + 1, md);
  return { date, next, days: daysBetween(today, next), yearly };
}

export async function countdownsCommand(args: string[]) {
  const p = parseArgs(args, SPEC, "countdowns");
  if (p.positionals.length) {
    throw usage(`unexpected argument "${p.positionals[0]}"`);
  }
  const fields = listValues([str(p, "fields")]);
  for (const f of fields) {
    if (!FIELDS.includes(f)) {
      throw usage(
        `unknown field "${f}"`,
        `Available fields: ${FIELDS.join(", ")}`,
      );
    }
  }
  const within =
    str(p, "within") !== undefined
      ? intFlag(p, "within", 0, 0, 3660)
      : undefined;
  const full = bool(p, "full");
  const tz = userTimeZone();
  const today = dateKey(Date.now(), tz);
  const raw = await apiLife.listCountdowns(getClient());
  const all = (Array.isArray(raw) ? raw : []).filter((c) => c && c.id);
  const dated = all
    .map((c) => ({ c, o: nextOccurrence(c, today) }))
    .sort((a, b) => {
      const da = a.o?.days ?? Number.NEGATIVE_INFINITY;
      const db = b.o?.days ?? Number.NEGATIVE_INFINITY;
      // Coming up first (soonest first), then past one-offs (latest first).
      if (da >= 0 && db >= 0) return da - db;
      if (da >= 0 || db >= 0) return da >= 0 ? -1 : 1;
      return db - da;
    });
  const shown =
    within === undefined
      ? dated
      : dated.filter(({ o }) => o && o.days >= 0 && o.days <= within);
  const scope =
    within === undefined
      ? "countdowns"
      : `countdowns in the next ${within} days`;
  if (shown.length === 0) {
    return {
      countdowns:
        within === undefined
          ? "0 countdowns found"
          : `0 ${scope} (${all.length} in total)`,
      help:
        within !== undefined && all.length
          ? ["Run `ticktick-axi countdowns` to see them all"]
          : ["Countdowns are created in the TickTick app"],
    };
  }
  const rows = shown.map(({ c, o }) => {
    const row: Record<string, unknown> = {
      id: c.id,
      name: full ? (c.name ?? "") : truncate(c.name ?? "", LIST_TITLE_MAX).text,
      next: o?.next ?? "",
      days: o?.days ?? "",
    };
    for (const f of fields) {
      if (f === "date") row.date = o?.date ?? "";
      if (f === "repeat") {
        row.repeat = o?.yearly
          ? "yearly"
          : (c.repeatFlag ?? "").replace(/^RRULE:/, "") || "none";
      }
      if (f === "years") {
        const n = o
          ? Number(o.next.slice(0, 4)) - Number(o.date.slice(0, 4))
          : 0;
        row.years = o?.yearly && n > 0 ? n : "";
      }
      if (f === "remark") {
        row.remark = full
          ? (c.remark ?? "")
          : truncate(c.remark ?? "", LIST_TITLE_MAX).text;
      }
    }
    return row;
  });
  const soon = dated.filter(({ o }) => o && o.days >= 0 && o.days <= 30).length;
  const out: Record<string, unknown> = {
    count: `${rows.length} of ${all.length} ${scope}`,
    today,
    next_30_days: soon,
    countdowns: rows,
  };
  if (within === undefined && soon) {
    out.help = [
      "Run `ticktick-axi countdowns --within 30` for just the next month",
    ];
  }
  return out;
}
