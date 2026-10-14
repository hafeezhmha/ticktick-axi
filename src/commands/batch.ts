import { readFileSync } from "node:fs";
import { bool, parseArgs, str } from "../args.js";
import { api, getClient, validateId, type Project } from "../api.js";
import { apiOrg } from "../api-org.js";
import {
  DATE_FORMATS,
  displayDate,
  formatApiDate,
  isValidTimeZone,
  parseUserDate,
  userTimeZone,
  zonedToUtc,
} from "../dates.js";
import { fail, usage } from "../errors.js";
import { PRIORITY, truncate } from "../format.js";
import { confirmHint, GATE } from "./org-common.js";

/** Documented cap on each of the `add` and `update` arrays. */
export const BATCH_MAX = 50;
const INPUT_MAX_BYTES = 1_000_000;

/** I/O seams so tests never touch the real stdin or disk. */
export const batchIo = {
  stdinIsTTY: () => Boolean(process.stdin.isTTY),
  readStdin: async (): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf-8");
  },
  readFile: (path: string) => readFileSync(path, "utf-8"),
};

export const BATCH_HELP = `usage: ticktick-axi batch (--file <path> | --stdin) [--yes]
Creates and updates many tasks in one request: up to ${BATCH_MAX} to add and ${BATCH_MAX} to update.
Input is JSON: {"add": [<task>, ...], "update": [<task>, ...]} (either may be left out).
  add:    each needs "title" and "projectId"
  update: each needs "id" and "projectId"; only the fields given change, but "tags" and
          "items" (checklist) replace the whole list. Moving projects is not allowed (use \`move\`).
Fields are those of the Open API Task: title, projectId, content, desc, dueDate, startDate,
isAllDay, timeZone, priority (none|low|medium|high or 0|1|3|5), tags, items, reminders,
repeatFlag, repeatFrom, sortOrder, status, kind, parentId, assigneeUsername (and id).
dueDate/startDate take ${DATE_FORMATS};
a plain date makes an all-day task. Times without a zone are read in your zone.
Everything is checked before sending; without --yes it is a dry run that sends nothing.
flags:
  --file <path>   read the JSON from a file (easiest to preview, then rerun with --yes)
  --stdin         read the JSON from a pipe
  --yes           actually send it
examples:
  ticktick-axi batch --file tasks.json
  ticktick-axi batch --file tasks.json --yes
  echo '{"add":[{"title":"Buy milk","projectId":"<projectId>","dueDate":"tomorrow"}]}' | ticktick-axi batch --stdin
`;

/** Meanings of the documented `id2error` codes. */
const ERRORS: Record<string, string> = {
  EXISTED: "a task with this id already exists",
  DELETED: "the task was deleted",
  NOT_EXISTED: "no task with this id",
  PROJECT_MOVE_ERROR:
    "projectId differs from the task's project; use `ticktick-axi move`",
  EXCEED_QUOTA: "the account's task limit is reached",
  NO_PROJECT_PERMISSION: "no permission on this project",
  NO_TEAM_PERMISSION: "no permission in this team",
  UNKNOWN: "TickTick did not say why",
};

const STRING_FIELDS = [
  "id",
  "projectId",
  "title",
  "content",
  "desc",
  "timeZone",
  "repeatFlag",
  "parentId",
  "assigneeUsername",
  "completedTime",
];
const FIELDS = [
  ...STRING_FIELDS,
  "dueDate",
  "startDate",
  "isAllDay",
  "priority",
  "tags",
  "items",
  "reminders",
  "repeatFrom",
  "sortOrder",
  "status",
  "kind",
];
const KINDS = ["TEXT", "NOTE", "CHECKLIST"];

type Op = "add" | "update";
type Json = Record<string, unknown>;

interface Checked {
  body: Json;
  preview: Json;
}

export async function batchCommand(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes", "stdin"],
      value: ["file"],
      renamed: {
        ...GATE,
        json: "Pass the JSON with --file <path> or --stdin",
        input: "Use --file <path> or --stdin",
        project:
          'Set "projectId" on each task in the JSON (see `ticktick-axi batch --help`)',
      },
    },
    "batch",
  );
  if (p.positionals.length) {
    throw usage(
      `unexpected argument "${p.positionals[0]}"`,
      "Pass the JSON with --file <path> or --stdin, not as an argument",
    );
  }
  const file = str(p, "file");
  const fromStdin = bool(p, "stdin");
  if ((file === undefined) === !fromStdin) {
    throw usage(
      file === undefined
        ? "batch needs its JSON from --file <path> or --stdin"
        : "--file and --stdin cannot be combined",
      "Run `ticktick-axi batch --help` for the input format",
    );
  }
  const text = await readInput(file);
  const input = parseInput(text);
  const tz = userTimeZone();
  const add = (input.add ?? []).map((t, i) => checkTask(t, "add", i, tz));
  const update = (input.update ?? []).map((t, i) =>
    checkTask(t, "update", i, tz),
  );
  const ids = update.map((u) => u.body.id as string);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) {
    throw usage(
      `update lists task ${dup} more than once`,
      "Merge its changes into one entry",
    );
  }

  const client = getClient();
  if (!bool(p, "yes")) {
    const out: Json = { dry_run: "nothing was sent" };
    if (add.length) {
      out.would_add = `${add.length} task(s)`;
      out.add = add.map((a) => a.preview);
    }
    if (update.length) {
      out.would_update = `${update.length} task(s)`;
      out.update = update.map((u) => u.preview);
    }
    const warnings = await unknownProjects(client, [...add, ...update]);
    if (update.some((u) => "tags" in u.body || "items" in u.body)) {
      warnings.push(
        'an update with "tags" or "items" replaces that whole list on the task',
      );
    }
    if (warnings.length) out.warnings = warnings;
    out.help = [
      fromStdin
        ? "Rerun `ticktick-axi batch --stdin --yes` with the same JSON piped in to send it (only after the person confirms)"
        : confirmHint(["batch"], args, "send it"),
    ];
    return out;
  }

  const body: { add?: Json[]; update?: Json[] } = {};
  if (add.length) body.add = add.map((a) => a.body);
  if (update.length) body.update = update.map((u) => u.body);
  const res = await apiOrg.batchTasks(client, body);
  if (!res || typeof res !== "object" || Array.isArray(res)) {
    throw fail(
      "WRITE_UNCERTAIN",
      "TickTick did not confirm the batch",
      "Run `ticktick-axi tasks --project <projectId>` to check what landed before retrying",
    );
  }
  const etags = isMap(res.id2etag) ? res.id2etag : {};
  const errors = isMap(res.id2error) ? res.id2error : {};
  const ok = Object.keys(etags);
  const updateIds = new Set(ids);
  const created = ok.filter((id) => !updateIds.has(id));
  const updated = ok.filter((id) => updateIds.has(id));
  const failed = Object.entries(errors).map(([id, code]) => ({
    id,
    error: String(code),
    meaning: ERRORS[String(code)] ?? "not documented",
  }));
  const total = add.length + update.length;
  const out: Json = { result: `${ok.length} of ${total} applied` };
  if (add.length) out.created = `${created.length} of ${add.length}`;
  if (created.length) out.created_ids = created;
  if (update.length) out.updated = `${updated.length} of ${update.length}`;
  if (failed.length) out.failed = failed;
  const projects = [
    ...new Set([...add, ...update].map((t) => t.body.projectId as string)),
  ];
  out.help = [
    ...(failed.length
      ? [
          "Fix the failed entries and send only those again; the others already landed",
        ]
      : []),
    projects.length === 1
      ? `Run \`ticktick-axi tasks --project ${projects[0]}\` to see them`
      : "Run `ticktick-axi tasks --project <projectId>` to see them",
  ];
  return out;
}

function isMap(v: unknown): v is Record<string, string> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

async function readInput(file: string | undefined): Promise<string> {
  let text: string;
  if (file !== undefined) {
    try {
      text = batchIo.readFile(file);
    } catch {
      throw usage(
        `could not read ${file}`,
        "Check the path; it is read relative to the current directory",
      );
    }
  } else {
    if (batchIo.stdinIsTTY()) {
      throw usage(
        "--stdin reads JSON from a pipe, not the keyboard",
        "Run `ticktick-axi batch --file <path>`, or pipe the JSON in",
      );
    }
    text = await batchIo.readStdin();
  }
  if (Buffer.byteLength(text) > INPUT_MAX_BYTES) {
    throw usage(
      `the input is over ${INPUT_MAX_BYTES / 1_000_000} MB`,
      `Send at most ${BATCH_MAX} tasks to add and ${BATCH_MAX} to update per batch`,
    );
  }
  return text;
}

function parseInput(text: string): { add?: unknown[]; update?: unknown[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw usage(
      "the input is not valid JSON",
      'Expected {"add": [...], "update": [...]}; see `ticktick-axi batch --help`',
    );
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw usage(
      "the input must be a JSON object",
      'Expected {"add": [...], "update": [...]}',
    );
  }
  const obj = data as Json;
  const extra = Object.keys(obj).filter((k) => k !== "add" && k !== "update");
  if (extra.length) {
    throw usage(
      `unknown key "${extra[0]}" in the input`,
      'Only "add" and "update" are allowed at the top level',
    );
  }
  for (const key of ["add", "update"] as const) {
    const v = obj[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) throw usage(`"${key}" must be an array of tasks`);
    if (v.length > BATCH_MAX) {
      throw usage(
        `"${key}" has ${v.length} tasks; TickTick takes at most ${BATCH_MAX}`,
        "Split them into several batches",
      );
    }
  }
  const add = obj.add as unknown[] | undefined;
  const update = obj.update as unknown[] | undefined;
  if (!add?.length && !update?.length) {
    throw usage(
      "nothing to send: add and update are both empty",
      'Expected {"add": [...], "update": [...]}',
    );
  }
  return { add, update };
}

/** Validate one task and convert friendly values to the API's. */
function checkTask(raw: unknown, op: Op, index: number, tz: string): Checked {
  const where = `${op}[${index}]`;
  const bad = (msg: string, ...hints: string[]) =>
    usage(`${where}: ${msg}`, ...hints);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw bad("must be a JSON object");
  }
  const t = raw as Json;
  const body: Json = {};
  for (const [k, v] of Object.entries(t)) {
    if (!FIELDS.includes(k)) {
      throw bad(`unknown field "${k}"`, `Task fields: ${FIELDS.join(", ")}`);
    }
    if (v === undefined) continue;
    if (STRING_FIELDS.includes(k) && typeof v !== "string") {
      throw bad(`"${k}" must be a string`);
    }
    body[k] = v;
  }

  for (const key of ["projectId", ...(op === "update" ? ["id"] : [])]) {
    if (typeof body[key] !== "string" || !body[key]) {
      throw bad(
        `"${key}" is required`,
        op === "add"
          ? 'Each task to add needs "title" and "projectId"'
          : 'Each task to update needs "id" and "projectId"',
      );
    }
  }
  if (body.projectId === "inbox") {
    throw bad(
      'use the Inbox\'s real id, not "inbox"',
      "Find it as the projectId of an Inbox task: `ticktick-axi tasks --project inbox`",
    );
  }
  validateId(body.projectId as string, "project id");
  if (body.id !== undefined) validateId(body.id as string, "task id");
  if (body.parentId) validateId(body.parentId as string, "task id");
  if (op === "add" || body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) throw bad('"title" cannot be empty');
    body.title = title;
  }
  if (body.isAllDay !== undefined && typeof body.isAllDay !== "boolean") {
    throw bad('"isAllDay" must be true or false');
  }
  if (
    body.timeZone !== undefined &&
    !isValidTimeZone(body.timeZone as string)
  ) {
    throw bad(`"timeZone" "${body.timeZone}" is not an IANA time zone`);
  }
  if (body.priority !== undefined) body.priority = priority(body.priority, bad);
  if (
    body.status !== undefined &&
    ![-1, 0, 2].includes(body.status as number)
  ) {
    throw bad('"status" must be 0 (open), 2 (completed) or -1 (abandoned)');
  }
  if (body.sortOrder !== undefined && !Number.isInteger(body.sortOrder)) {
    throw bad('"sortOrder" must be a whole number');
  }
  if (body.repeatFrom !== undefined) {
    const v = String(body.repeatFrom);
    if (!["0", "1", "2"].includes(v)) {
      throw bad('"repeatFrom" must be "0", "1" or "2"');
    }
    body.repeatFrom = v;
  }
  if (body.kind !== undefined) {
    const v = String(body.kind).toUpperCase();
    if (!KINDS.includes(v)) {
      throw bad(`"kind" must be one of ${KINDS.join(", ")}`);
    }
    body.kind = v;
  }
  for (const key of ["tags", "reminders"]) {
    const v = body[key];
    if (
      v !== undefined &&
      (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    ) {
      throw bad(`"${key}" must be an array of strings`);
    }
  }
  if (body.items !== undefined) {
    const items = body.items;
    if (
      !Array.isArray(items) ||
      items.some(
        (i) =>
          !i || typeof i !== "object" || typeof (i as Json).title !== "string",
      )
    ) {
      throw bad('"items" must be an array of objects with a "title"');
    }
  }
  const due = dates(body, op, tz, bad);
  return { body, preview: preview(body, op, index, due) };
}

function priority(
  v: unknown,
  bad: (msg: string, ...hints: string[]) => Error,
): number {
  if (typeof v === "string" && v.toLowerCase() in PRIORITY) {
    return PRIORITY[v.toLowerCase()];
  }
  if (typeof v === "number" && Object.values(PRIORITY).includes(v)) return v;
  throw bad(
    `"priority" ${JSON.stringify(v)} is not valid`,
    "Use none, low, medium, high (or 0, 1, 3, 5)",
  );
}

/** Convert dueDate/startDate to the API format; returns the due for display. */
function dates(
  body: Json,
  op: Op,
  tz: string,
  bad: (msg: string, ...hints: string[]) => Error,
): string | undefined {
  const zone = (body.timeZone as string | undefined) ?? tz;
  const kinds: boolean[] = [];
  let shown: string | undefined;
  for (const key of ["dueDate", "startDate"] as const) {
    const v = body[key];
    if (v === undefined) continue;
    if (v === null) {
      if (op === "add") throw bad(`"${key}" cannot be null when adding`);
      if (key === "dueDate") shown = "cleared";
      continue;
    }
    if (typeof v !== "string") throw bad(`"${key}" must be a date string`);
    const ud = parseUserDate(v, `${key} in ${op}`, zone);
    let instant: number;
    if (ud.kind === "date") {
      const [y, m, d] = ud.key.split("-").map(Number);
      instant = zonedToUtc(y, m, d, 0, 0, zone);
    } else {
      instant = ud.instant;
    }
    kinds.push(ud.kind === "date");
    body[key] = formatApiDate(instant);
    if (key === "dueDate") {
      shown = ud.kind === "date" ? `${ud.key} (all day)` : undefined;
    }
  }
  if (kinds.length === 0) return shown;
  if (body.isAllDay === undefined) {
    if (kinds.length === 2 && kinds[0] !== kinds[1]) {
      throw bad(
        "dueDate and startDate must both be dates or both be date-times",
        'Or set "isAllDay" explicitly',
      );
    }
    body.isAllDay = kinds[0];
  }
  if (body.timeZone === undefined) body.timeZone = zone;
  if (shown === undefined && typeof body.dueDate === "string") {
    shown =
      displayDate(body.dueDate, !!body.isAllDay, tz, zone) ??
      (body.dueDate as string);
  }
  return shown;
}

/** A short display of one field's new value. */
function shown(key: string, v: unknown, due?: string): string {
  if (key === "dueDate") return due ?? String(v);
  if (v === null) return "none";
  if (key === "items" && Array.isArray(v)) return `${v.length} item(s)`;
  if (Array.isArray(v)) return v.join(",") || "none";
  return truncate(String(v), 40).text;
}

function preview(body: Json, op: Op, index: number, due?: string): Json {
  // isAllDay and timeZone go with a date and show in its display.
  const dated = "dueDate" in body || "startDate" in body;
  const other = (skip: string[]) =>
    Object.keys(body)
      .filter((k) => !skip.includes(k))
      .filter((k) => !(dated && (k === "isAllDay" || k === "timeZone")))
      .map((k) => `${k}=${shown(k, body[k], due)}`)
      .join(" ");
  if (op === "add") {
    return {
      n: index + 1,
      projectId: body.projectId,
      title: truncate(body.title as string, 80).text,
      due: due ?? "none",
      also: other(["id", "projectId", "title", "dueDate"]) || "none",
    };
  }
  return {
    id: body.id,
    projectId: body.projectId,
    set: other(["id", "projectId"]) || "(nothing)",
  };
}

/** Project ids that GET /project does not know (inbox ids are always fine). */
async function unknownProjects(
  client: ReturnType<typeof getClient>,
  tasks: Checked[],
): Promise<string[]> {
  const raw = await api.listProjects(client);
  const known = new Set(
    (Array.isArray(raw) ? (raw as Project[]) : []).map((x) => x.id),
  );
  const missing = [
    ...new Set(
      tasks
        .map((t) => t.body.projectId as string)
        .filter((id) => !id.startsWith("inbox") && !known.has(id)),
    ),
  ];
  return missing.map(
    (id) =>
      `project ${id} is not in your project list (run \`ticktick-axi projects\`); those tasks will likely fail`,
  );
}
