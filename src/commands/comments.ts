import { bool, expectPositionals, parseArgs, shellQuote } from "../args.js";
import { api, getClient, validateId } from "../api.js";
import { displayDate, formatApiDate, userTimeZone } from "../dates.js";
import { fail, usage } from "../errors.js";
import { truncate } from "../format.js";

const GATE = {
  confirm: "--confirm is not a flag; add --yes to apply the change",
  force: "--force is not a flag; add --yes to apply the change",
  "dry-run": "Dry run is the default; omit --yes to preview",
};

export const COMMENTS_HELP = `usage: ticktick-axi comments <projectId> <taskId> [--full]
Lists a task's comments, oldest first.
flags:
  --full   do not truncate comment text (default: 200 chars)
examples:
  ticktick-axi comments <projectId> <taskId>
`;

export const COMMENT_HELP = `usage: ticktick-axi comment <add|delete> <projectId> <taskId> ... [--yes]
add <projectId> <taskId> "<text>"          add a comment
delete <projectId> <taskId> <commentId>    delete a comment (ids from \`ticktick-axi comments\`)
Without --yes both are dry runs that send nothing.
examples:
  ticktick-axi comment add <projectId> <taskId> "Called them, waiting to hear back"
  ticktick-axi comment delete <projectId> <taskId> <commentId> --yes
`;

/** Comment times arrive as epoch milliseconds (live API) or date strings (docs). */
function commentTime(v: string | number | undefined): string | undefined {
  return typeof v === "number" ? formatApiDate(v) : v;
}

export async function commentsCommand(args: string[]) {
  const p = parseArgs(args, { bool: ["full"] }, "comments");
  const [projectId, taskId] = expectPositionals(
    p,
    2,
    "ticktick-axi comments <projectId> <taskId>",
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  const tz = userTimeZone();
  const full = bool(p, "full");
  const raw = await api.listComments(getClient(), projectId, taskId);
  const comments = Array.isArray(raw) ? raw : [];
  const add = `Run \`ticktick-axi comment add ${projectId} ${taskId} "<text>"\` to preview adding one`;
  if (comments.length === 0) {
    return { comments: "0 comments on this task", help: [add] };
  }
  const sorted = [...comments].sort((a, b) =>
    (commentTime(a.createdTime) ?? "").localeCompare(
      commentTime(b.createdTime) ?? "",
    ),
  );
  return {
    count: `${comments.length} comment(s)`,
    comments: sorted.map((c) => ({
      id: c.id,
      created: displayDate(commentTime(c.createdTime), false, tz) ?? "",
      text: full ? (c.title ?? "") : truncate(c.title ?? "", 200).text,
    })),
    help: [add],
  };
}

export async function commentCommand(args: string[]) {
  const [sub, ...rest] = args;
  if (sub === "add") return addComment(rest);
  if (sub === "delete") return deleteComment(rest);
  throw usage(
    sub ? `unknown comment subcommand "${sub}"` : "comment needs add or delete",
    'Use `ticktick-axi comment add <projectId> <taskId> "<text>"` or `comment delete <projectId> <taskId> <commentId>`',
  );
}

function hint(args: string[], verb: string) {
  const line = ["ticktick-axi", "comment", ...args.map(shellQuote)].join(" ");
  return `Run \`${line} --yes\` to ${verb} (only after the person confirms)`;
}

async function addComment(args: string[]) {
  const p = parseArgs(args, { bool: ["yes"], renamed: GATE }, "comment add");
  const [projectId, taskId, raw] = expectPositionals(
    p,
    3,
    'ticktick-axi comment add <projectId> <taskId> "<text>"',
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  const text = raw.trim();
  if (!text) throw usage("Comment text cannot be empty");
  const client = getClient();
  const t = await api.getTask(client, projectId, taskId);
  const task = { id: taskId, title: t.title ?? "" };
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      task,
      would_add: truncate(text, 200).text,
      help: [hint(["add", projectId, taskId, raw], "add it")],
    };
  }
  const c = await api.addComment(client, projectId, taskId, text);
  return {
    added: { id: c?.id ?? "(unknown)", task: task.title },
    help: [
      `Run \`ticktick-axi comments ${projectId} ${taskId}\` to see all comments`,
    ],
  };
}

async function deleteComment(args: string[]) {
  const p = parseArgs(args, { bool: ["yes"], renamed: GATE }, "comment delete");
  const [projectId, taskId, commentId] = expectPositionals(
    p,
    3,
    "ticktick-axi comment delete <projectId> <taskId> <commentId>",
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  validateId(commentId, "comment id");
  const client = getClient();
  const raw = await api.listComments(client, projectId, taskId);
  const comments = Array.isArray(raw) ? raw : [];
  const c = comments.find((x) => x.id === commentId);
  if (!c) {
    throw fail(
      "NOT_FOUND",
      `No comment ${commentId} on task ${taskId}`,
      `Run \`ticktick-axi comments ${projectId} ${taskId}\` to list comment ids`,
    );
  }
  const ref = { id: commentId, text: truncate(c.title ?? "", 200).text };
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      would_delete: ref,
      help: [hint(["delete", projectId, taskId, commentId], "delete it")],
    };
  }
  await api.deleteComment(client, projectId, taskId, commentId);
  return {
    deleted: ref,
    help: [
      `Run \`ticktick-axi comments ${projectId} ${taskId}\` to see what's left`,
    ],
  };
}
