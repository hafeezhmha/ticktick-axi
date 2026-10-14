import { bool, expectPositionals, parseArgs } from "../args.js";
import { api, getClient, validateId, type Task } from "../api.js";
import { displayDate, dueInfo, isOverdue, userTimeZone } from "../dates.js";
import {
  checklistSummary,
  DETAIL_BODY_MAX,
  priorityName,
  statusName,
  truncate,
} from "../format.js";

export const TASK_HELP = `usage: ticktick-axi task <projectId> <taskId> [--full]
Shows one task: status, due, priority, tags, repeat rule, checklist, and content.
The Open API addresses a task by project id + task id; both appear in \`ticktick-axi tasks\`.
flags:
  --full   show the complete content and every checklist item (default: first ${DETAIL_BODY_MAX} chars, 20 items)
examples:
  ticktick-axi task 6226ff9877acee87727f6bca 63b7bebb91c0a5474805fcd4
  ticktick-axi task <projectId> <taskId> --full
`;

const ITEM_LIMIT = 20;

export async function taskCommand(args: string[]) {
  const p = parseArgs(args, { bool: ["full"] }, "task");
  const [projectId, taskId] = expectPositionals(
    p,
    2,
    "ticktick-axi task <projectId> <taskId>",
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  const full = bool(p, "full");
  const tz = userTimeZone();
  const t = await api.getTask(getClient(), projectId, taskId);
  return renderTask(t, tz, full);
}

export function renderTask(t: Task, tz: string, full: boolean) {
  const due = dueInfo(t, tz);
  const status = statusName(t.status);
  const task: Record<string, unknown> = {
    id: t.id,
    projectId: t.projectId,
    title: t.title ?? "",
    status,
    priority: priorityName(t.priority),
    due: due
      ? `${due.display}${due.allDay ? " (all day)" : ` (${tz})`}`
      : "none",
  };
  if (due && status === "open" && isOverdue(due, tz, Date.now())) {
    task.overdue = true;
  }
  const start = displayDate(t.startDate, !!t.isAllDay, tz, t.timeZone);
  if (start) task.start = start;
  if (t.tags?.length) task.tags = t.tags.join(", ");
  if (t.repeatFlag) task.repeat = t.repeatFlag.replace(/^RRULE:/, "");
  if (t.timeZone) task.timeZone = t.timeZone;
  if (t.kind) task.kind = t.kind;
  if (t.parentId) task.parentId = t.parentId;
  const completed = displayDate(t.completedTime, false, tz);
  if (status === "completed" && completed) task.completed = completed;

  const help: string[] = [];
  let truncated = false;
  for (const field of ["content", "desc"] as const) {
    const body = t[field];
    if (!body) continue;
    if (full) {
      task[field] = body;
      continue;
    }
    const tr = truncate(body, DETAIL_BODY_MAX);
    task[field] = tr.truncated
      ? `${tr.text} (truncated, ${tr.total} chars total)`
      : tr.text;
    truncated ||= tr.truncated;
  }

  const items = t.items ?? [];
  if (items.length) {
    task.checklist = checklistSummary(t);
    const shown = full ? items : items.slice(0, ITEM_LIMIT);
    task.items = shown.map((i, n) => ({
      n: n + 1,
      id: i.id ?? "",
      title: full ? (i.title ?? "") : truncate(i.title ?? "", 100).text,
      done: i.status === 1,
    }));
    truncated ||= shown.length < items.length;
  }

  if (truncated) {
    help.push(
      `Run \`ticktick-axi task ${t.projectId} ${t.id} --full\` to see everything`,
    );
  }
  const out: Record<string, unknown> = { task };
  if (status === "open") {
    help.push(
      `Run \`ticktick-axi complete ${t.projectId} ${t.id}\` to preview completing it`,
      `Run \`ticktick-axi edit ${t.projectId} ${t.id} --due <date>\` to preview a change`,
    );
    if (items.length) {
      help.push(
        `Run \`ticktick-axi item done ${t.projectId} ${t.id} <n>\` to preview ticking off an item`,
      );
    }
  }
  if (help.length) out.help = help;
  return out;
}
