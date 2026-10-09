import {
  bool,
  expectPositionals,
  listValues,
  parseArgs,
  shellQuote,
  str,
  type FlagSpec,
  type ParsedArgs,
} from "../args.js";
import { api, getClient, validateId, type Task } from "../api.js";
import {
  DATE_FORMATS,
  dueInfo,
  displayDate,
  formatApiDate,
  parseUserDate,
  userTimeZone,
  zonedToUtc,
  type UserDate,
} from "../dates.js";
import { usage } from "../errors.js";
import {
  parsePriority,
  priorityName,
  statusName,
  truncate,
} from "../format.js";

/**
 * Write commands. Every write is gated: without `--yes` the command fetches
 * what it needs, prints exactly what would change, sends nothing, and exits 0.
 * The binary never prompts; the agent relays the dry run to the person and
 * reruns with `--yes` only after they confirm. Writes are never retried
 * automatically (see http.ts).
 */

const GATE_RENAMED: Record<string, string> = {
  confirm: "--confirm is not a flag; add --yes to apply the change",
  execute: "--execute is not a flag; add --yes to apply the change",
  force: "--force is not a flag; add --yes to apply the change",
  "dry-run": "Dry run is the default; omit --yes to preview",
  list: "--list is not a flag; use --project <id>",
  json: "Output is always TOON",
};

const CREATE_SPEC: FlagSpec = {
  bool: ["yes"],
  value: ["project", "due", "start", "priority", "content"],
  repeat: ["tag"],
  renamed: {
    ...GATE_RENAMED,
    title: 'The title is the first argument: create "<title>" --project <id>',
  },
};

const EDIT_SPEC: FlagSpec = {
  bool: ["yes"],
  value: ["title", "due", "start", "priority", "content"],
  repeat: ["tag"],
  renamed: {
    ...GATE_RENAMED,
    project:
      "Moving tasks between projects is not supported; the project id is the first argument",
    status:
      "Use `ticktick-axi complete <projectId> <taskId>` to complete a task",
  },
};

export const CREATE_HELP = `usage: ticktick-axi create "<title>" --project <id> [flags] [--yes]
Creates a task. Without --yes this is a dry run: it shows what would be created and sends nothing.
flags:
  --project <id>     required; ids from \`ticktick-axi projects\` (or an inbox id like inbox123 from \`tasks\`)
  --due <date>       due date (all-day) or date-time (timed)
  --start <date>     start date or date-time (same kind as --due)
  --priority <p>     none | low | medium | high
  --tag <tag>        tag (repeatable or comma-separated)
  --content <text>   notes / description
  --yes              actually create it
dates: ${DATE_FORMATS}
examples:
  ticktick-axi create "Pay rent" --project <projectId> --due 2026-11-01 --priority high
  ticktick-axi create "Call the bank" --project <projectId> --due "2026-10-12T10:30" --yes
`;

export const EDIT_HELP = `usage: ticktick-axi edit <projectId> <taskId> [flags] [--yes]
Changes a task. Without --yes this is a dry run showing each field's old and new value.
Only the fields you pass are sent; a change that is already in place is a no-op.
flags:
  --title <text>, --due <date>, --start <date>, --priority <p>, --content <text>
  --tag <tag>        replaces the task's tags (repeatable or comma-separated)
  --yes              actually apply it
dates: ${DATE_FORMATS}
examples:
  ticktick-axi edit <projectId> <taskId> --due tomorrow
  ticktick-axi edit <projectId> <taskId> --priority high --title "Renew passport" --yes
`;

export const COMPLETE_HELP = `usage: ticktick-axi complete <projectId> <taskId> [--yes]
Marks a task completed. Without --yes this is a dry run. Completing an already-completed task is a no-op.
For a repeating task, TickTick completes this occurrence and schedules the next one.
flags:
  --yes   actually complete it
examples:
  ticktick-axi complete <projectId> <taskId>
  ticktick-axi complete <projectId> <taskId> --yes
`;

function confirmHint(command: string, args: string[], verb: string): string {
  const line = ["ticktick-axi", command, ...args]
    .map((a, i) => (i < 2 ? a : shellQuote(a)))
    .join(" ");
  return `Run \`${line} --yes\` to ${verb} (only after the person confirms)`;
}

interface DateChange {
  field: "dueDate" | "startDate";
  value: string;
  allDay: boolean;
  display: string;
}

function toApiDate(
  ud: UserDate,
  field: DateChange["field"],
  tz: string,
): DateChange {
  if (ud.kind === "date") {
    const [y, m, d] = ud.key.split("-").map(Number);
    return {
      field,
      value: formatApiDate(zonedToUtc(y, m, d, 0, 0, tz)),
      allDay: true,
      display: ud.key,
    };
  }
  const display = displayDate(formatApiDate(ud.instant), false, tz) as string;
  return { field, value: formatApiDate(ud.instant), allDay: false, display };
}

function parseDates(p: ParsedArgs, tz: string): DateChange[] {
  const out: DateChange[] = [];
  const due = str(p, "due");
  const start = str(p, "start");
  if (due !== undefined) {
    out.push(toApiDate(parseUserDate(due, "--due", tz), "dueDate", tz));
  }
  if (start !== undefined) {
    out.push(toApiDate(parseUserDate(start, "--start", tz), "startDate", tz));
  }
  if (out.length === 2 && out[0].allDay !== out[1].allDay) {
    throw usage(
      "--due and --start must both be dates or both be date-times",
      "TickTick has one all-day flag per task, e.g. --start 2026-10-10 --due 2026-10-12",
    );
  }
  return out;
}

function nonEmpty(value: string, flag: string): string {
  const v = value.trim();
  if (!v) throw usage(`${flag} cannot be empty`);
  return v;
}

export async function createCommand(args: string[]) {
  const p = parseArgs(args, CREATE_SPEC, "create");
  const [rawTitle] = expectPositionals(
    p,
    1,
    'ticktick-axi create "<title>" --project <id> [--due <date>] [--yes]',
  );
  const title = nonEmpty(rawTitle, "title");
  const projectId = str(p, "project");
  if (!projectId) {
    throw usage(
      "--project is required (the Open API needs a project id to create a task)",
      "Run `ticktick-axi projects` to list project ids",
    );
  }
  if (projectId === "inbox") {
    throw usage(
      "The Open API documents no `inbox` alias for creating tasks",
      "Pass the inbox's real id (projectId of an Inbox task, like inbox123456, from `ticktick-axi tasks --project inbox`) or another project id",
    );
  }
  validateId(projectId, "project id");
  const tz = userTimeZone();
  const dates = parseDates(p, tz);
  const priorityRaw = str(p, "priority");
  const priority =
    priorityRaw !== undefined ? parsePriority(priorityRaw) : undefined;
  const tags = listValues(p.multi.tag ?? []);
  const content = str(p, "content");

  const body: Record<string, unknown> = { title, projectId };
  for (const d of dates) body[d.field] = d.value;
  if (dates.length) {
    body.isAllDay = dates[0].allDay;
    body.timeZone = tz;
  }
  if (priority !== undefined) body.priority = priority;
  if (tags.length) body.tags = tags;
  if (content !== undefined) body.content = content;

  const preview: Record<string, unknown> = { title, projectId };
  for (const d of dates) {
    preview[d.field === "dueDate" ? "due" : "start"] =
      `${d.display}${d.allDay ? " (all day)" : ` (${tz})`}`;
  }
  if (priority !== undefined) preview.priority = priorityName(priority);
  if (tags.length) preview.tags = tags.join(", ");
  if (content !== undefined) preview.content = truncate(content, 200).text;

  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      would_create: preview,
      help: [confirmHint("create", args, "create it")],
    };
  }

  const created = await api.createTask(getClient(), body);
  const id = created?.id ?? "(unknown)";
  const pid = created?.projectId ?? projectId;
  return {
    created: {
      id,
      projectId: pid,
      title: created?.title ?? title,
      due: (created && dueInfo(created, tz)?.display) || "none",
    },
    help: [
      `Run \`ticktick-axi task ${pid} ${id}\` to view it`,
      `Run \`ticktick-axi complete ${pid} ${id}\` to preview completing it`,
    ],
  };
}

export async function editCommand(args: string[]) {
  const p = parseArgs(args, EDIT_SPEC, "edit");
  const [projectId, taskId] = expectPositionals(
    p,
    2,
    "ticktick-axi edit <projectId> <taskId> [--title ...] [--due ...] [--yes]",
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  const tz = userTimeZone();

  const want: Record<string, unknown> = {};
  const titleRaw = str(p, "title");
  if (titleRaw !== undefined) want.title = nonEmpty(titleRaw, "--title");
  const dates = parseDates(p, tz);
  const priorityRaw = str(p, "priority");
  if (priorityRaw !== undefined) want.priority = parsePriority(priorityRaw);
  if (p.multi.tag) want.tags = listValues(p.multi.tag);
  const content = str(p, "content");
  if (content !== undefined) want.content = content;
  if (Object.keys(want).length === 0 && dates.length === 0) {
    throw usage(
      "Nothing to change",
      "Pass at least one of --title, --due, --start, --priority, --tag, --content",
    );
  }

  const client = getClient();
  const current = await api.getTask(client, projectId, taskId);
  const changes: Array<{ field: string; from: string; to: string }> = [];
  const body: Record<string, unknown> = { id: taskId, projectId };

  if (want.title !== undefined && want.title !== (current.title ?? "")) {
    changes.push({
      field: "title",
      from: current.title ?? "",
      to: want.title as string,
    });
    body.title = want.title;
  }
  if (
    want.priority !== undefined &&
    want.priority !== (current.priority ?? 0)
  ) {
    changes.push({
      field: "priority",
      from: priorityName(current.priority),
      to: priorityName(want.priority as number),
    });
    body.priority = want.priority;
  }
  if (want.tags !== undefined) {
    const before = (current.tags ?? []).join(", ");
    const after = (want.tags as string[]).join(", ");
    if (before !== after) {
      changes.push({
        field: "tags",
        from: before || "none",
        to: after || "none",
      });
      body.tags = want.tags;
    }
  }
  if (want.content !== undefined && want.content !== (current.content ?? "")) {
    changes.push({
      field: "content",
      from: truncate(current.content ?? "", 80).text || "none",
      to: truncate(want.content as string, 80).text || "none",
    });
    body.content = want.content;
  }
  for (const d of dates) {
    const old = displayDate(
      current[d.field],
      !!current.isAllDay,
      tz,
      current.timeZone,
    );
    const same = old === d.display && !!current.isAllDay === d.allDay;
    if (same) continue;
    changes.push({
      field: d.field === "dueDate" ? "due" : "start",
      from: old ?? "none",
      to: `${d.display}${d.allDay ? " (all day)" : ""}`,
    });
    body[d.field] = d.value;
    body.isAllDay = d.allDay;
    body.timeZone = tz;
  }

  const ref = { id: taskId, title: current.title ?? "" };
  if (changes.length === 0) {
    return {
      task: { ...ref, result: "no changes (already as requested)" },
    };
  }
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      task: ref,
      changes,
      help: [confirmHint("edit", args, "apply it")],
    };
  }
  const updated = await api.updateTask(client, taskId, body);
  return {
    updated: { ...ref, title: updated?.title ?? ref.title },
    changes,
    help: [`Run \`ticktick-axi task ${projectId} ${taskId}\` to view it`],
  };
}

export async function completeCommand(args: string[]) {
  const p = parseArgs(
    args,
    { bool: ["yes"], renamed: GATE_RENAMED },
    "complete",
  );
  const [projectId, taskId] = expectPositionals(
    p,
    2,
    "ticktick-axi complete <projectId> <taskId> [--yes]",
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  const client = getClient();
  const t: Task = await api.getTask(client, projectId, taskId);
  const status = statusName(t.status);
  const ref = { id: taskId, title: t.title ?? "" };
  if (status === "completed") {
    return { task: { ...ref, result: "already completed (no-op)" } };
  }
  if (!bool(p, "yes")) {
    const out: Record<string, unknown> = {
      dry_run: "nothing was sent",
      task: ref,
      would_change: `status: ${status} -> completed`,
    };
    if (t.repeatFlag) {
      out.note = `repeating task (${t.repeatFlag.replace(/^RRULE:/, "")}): TickTick completes this occurrence and schedules the next`;
    }
    out.help = [confirmHint("complete", args, "complete it")];
    return out;
  }
  await api.completeTask(client, projectId, taskId);
  return {
    completed: ref,
    ...(t.repeatFlag
      ? { note: "repeating task: the next occurrence is scheduled by TickTick" }
      : {}),
    help: [
      `Run \`ticktick-axi tasks --project ${projectId}\` to see what's left in this project`,
    ],
  };
}
