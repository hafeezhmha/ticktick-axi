import { api, FILTER_CAP, validateId, type Task } from "./api.js";
import {
  addDays,
  compareToBound,
  dateKey,
  dueInfo,
  isOverdue,
  type UserDate,
} from "./dates.js";
import type { TickTickClient } from "./http.js";

export interface TaskQuery {
  /** A project id, or the alias `inbox`. */
  projectId?: string;
  statusName: string;
  statusCodes: number[];
  priority?: number[];
  tags?: string[];
  dueBefore?: UserDate;
  dueAfter?: UserDate;
  overdue?: boolean;
  upcomingDays?: number;
}

export interface FetchResult {
  tasks: Task[];
  /** The API's 200-result cap was hit, so the list may be incomplete. */
  capped: boolean;
}

const isInboxId = (id: string) => /^inbox/i.test(id);

/**
 * Fetch tasks with documented endpoints only.
 *
 * - Open tasks of one project: GET /project/{id}/data (all undone tasks,
 *   no cap).
 * - Everything else: POST /task/filter (documented cap: 200 tasks), with
 *   project/status/priority/tag filtered server-side.
 * - The Open API documents no inbox listing, and /project does not return the
 *   inbox. `--project inbox` therefore uses /task/filter and keeps tasks whose
 *   projectId is the user's inbox id (`inbox<digits>`).
 * Due-date filters (before/after/overdue/upcoming) are applied client-side:
 * the filter endpoint only filters on startDate.
 */
export async function fetchTasks(
  client: TickTickClient,
  q: TaskQuery,
): Promise<FetchResult> {
  const project = q.projectId;
  if (project && project !== "inbox") validateId(project, "project id");

  const openOnly = q.statusCodes.length === 1 && q.statusCodes[0] === 0;
  if (project && project !== "inbox" && openOnly) {
    const data = await api.projectData(client, project);
    let tasks = (data?.tasks ?? []).filter((t) => (t.status ?? 0) === 0);
    if (q.priority?.length) {
      tasks = tasks.filter((t) => q.priority!.includes(t.priority ?? 0));
    }
    if (q.tags?.length) {
      tasks = tasks.filter((t) =>
        q.tags!.every((tag) => (t.tags ?? []).includes(tag)),
      );
    }
    return { tasks, capped: false };
  }

  const body: Parameters<typeof api.filterTasks>[1] = { status: q.statusCodes };
  if (project && project !== "inbox") body.projectIds = [project];
  if (q.priority?.length) body.priority = q.priority;
  if (q.tags?.length) body.tag = q.tags;
  const result = (await api.filterTasks(client, body)) ?? [];
  const capped = result.length >= FILTER_CAP;
  const tasks =
    project === "inbox"
      ? result.filter((t) => isInboxId(t.projectId ?? ""))
      : result;
  return { tasks, capped };
}

/** Client-side due-date filtering. */
export function applyDueFilters(
  tasks: Task[],
  q: TaskQuery,
  tz: string,
  now: number,
): Task[] {
  const needsDue =
    q.dueBefore || q.dueAfter || q.overdue || q.upcomingDays !== undefined;
  if (!needsDue) return tasks;
  const today = dateKey(now, tz);
  return tasks.filter((t) => {
    const info = dueInfo(t, tz);
    if (!info) return false;
    if (q.dueBefore && compareToBound(info, q.dueBefore) >= 0) return false;
    if (q.dueAfter && compareToBound(info, q.dueAfter) <= 0) return false;
    if (q.overdue && !isOverdue(info, tz, now)) return false;
    if (q.upcomingDays !== undefined) {
      if (isOverdue(info, tz, now)) return false;
      if (info.key > addDays(today, q.upcomingDays)) return false;
    }
    return true;
  });
}

/** Due soonest first, undated last, then higher priority, then title. */
export function sortTasks(tasks: Task[], tz: string): Task[] {
  return [...tasks].sort((a, b) => {
    const da = dueInfo(a, tz)?.instant ?? Number.POSITIVE_INFINITY;
    const db = dueInfo(b, tz)?.instant ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da < db ? -1 : 1;
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
}
