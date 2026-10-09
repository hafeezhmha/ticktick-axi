import type { Task } from "./api.js";
import { displayDate, dueInfo } from "./dates.js";
import { usage } from "./errors.js";

/** Open API priority values: None 0, Low 1, Medium 3, High 5. */
export const PRIORITY: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 3,
  high: 5,
};

export function priorityName(value: number | undefined): string {
  for (const [name, n] of Object.entries(PRIORITY)) {
    if (n === (value ?? 0)) return name;
  }
  return String(value);
}

export function parsePriority(input: string, flag = "--priority"): number {
  const v = input.trim().toLowerCase();
  if (v in PRIORITY) return PRIORITY[v];
  if (/^\d$/.test(v) && Object.values(PRIORITY).includes(Number(v))) {
    return Number(v);
  }
  throw usage(
    `${flag} "${input}" is not a valid priority`,
    "Use one of: none, low, medium, high (or 0, 1, 3, 5)",
  );
}

/** Open API task status values: Abandoned -1, Normal 0, Completed 2. */
export const STATUS: Record<string, number[]> = {
  open: [0],
  completed: [2],
  abandoned: [-1],
  all: [0, 2, -1],
};

export function statusName(value: number | undefined): string {
  if (value === 2) return "completed";
  if (value === -1) return "abandoned";
  return "open";
}

export function parseStatus(input: string): { name: string; codes: number[] } {
  const v = input.trim().toLowerCase();
  if (!(v in STATUS)) {
    throw usage(
      `--status "${input}" is not valid`,
      "Use one of: open, completed, abandoned, all",
    );
  }
  return { name: v, codes: STATUS[v] };
}

export interface Truncated {
  text: string;
  truncated: boolean;
  total: number;
}

export function truncate(text: string, max: number): Truncated {
  if (text.length <= max) {
    return { text, truncated: false, total: text.length };
  }
  return {
    text: `${text.slice(0, max)}...`,
    truncated: true,
    total: text.length,
  };
}

export const LIST_TITLE_MAX = 100;
export const DETAIL_BODY_MAX = 1000;

/** Extra columns `--fields` can add to a task list. */
export const TASK_FIELDS = [
  "projectId",
  "priority",
  "status",
  "tags",
  "start",
  "allDay",
  "repeat",
  "completed",
  "kind",
  "items",
  "content",
] as const;

export function parseFields(raw: string | undefined): string[] {
  if (!raw) return [];
  const fields = raw
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  for (const f of fields) {
    if (!(TASK_FIELDS as readonly string[]).includes(f)) {
      throw usage(
        `unknown field "${f}"`,
        `Available fields: ${TASK_FIELDS.join(", ")}`,
      );
    }
  }
  return fields;
}

export interface RowOptions {
  tz: string;
  /** Default columns before any `--fields` extras. */
  base: string[];
  extra: string[];
  full: boolean;
}

/** Build a compact list row: base columns, then requested extras. */
export function taskRow(task: Task, o: RowOptions): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const columns = [...o.base, ...o.extra.filter((f) => !o.base.includes(f))];
  for (const col of columns) {
    row[col] = cell(task, col, o);
  }
  return row;
}

function cell(task: Task, col: string, o: RowOptions): unknown {
  switch (col) {
    case "id":
      return task.id;
    case "projectId":
      return task.projectId;
    case "title": {
      const title = task.title ?? "";
      return o.full ? title : truncate(title, LIST_TITLE_MAX).text;
    }
    case "due":
      return dueInfo(task, o.tz)?.display ?? "";
    case "priority":
      return priorityName(task.priority);
    case "status":
      return statusName(task.status);
    case "tags":
      return (task.tags ?? []).join(" ");
    case "start":
      return (
        displayDate(task.startDate, !!task.isAllDay, o.tz, task.timeZone) ?? ""
      );
    case "allDay":
      return !!task.isAllDay;
    case "repeat":
      return task.repeatFlag ? task.repeatFlag.replace(/^RRULE:/, "") : "";
    case "completed":
      return displayDate(task.completedTime, false, o.tz) ?? "";
    case "kind":
      return task.kind ?? "";
    case "items":
      return checklistSummary(task) ?? "";
    case "content": {
      const body = task.content ?? "";
      return o.full ? body : truncate(body, LIST_TITLE_MAX).text;
    }
    /* c8 ignore next 2 -- columns are validated by parseFields */
    default:
      return "";
  }
}

export function checklistSummary(task: Task): string | undefined {
  const items = task.items ?? [];
  if (items.length === 0) return undefined;
  const done = items.filter((i) => i.status === 1).length;
  return `${done}/${items.length} done`;
}
