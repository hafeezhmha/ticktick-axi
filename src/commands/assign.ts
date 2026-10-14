import { bool, expectPositionals, parseArgs } from "../args.js";
import { api, getClient, validateId } from "../api.js";
import { apiOrg, type AssignedTask } from "../api-org.js";
import { fail, usage } from "../errors.js";
import { confirmHint, GATE } from "./org-common.js";

export const ASSIGN_HELP = `usage: ticktick-axi assign <projectId> <taskId> <username> [--yes]
Assigns a task to a member of its (shared) project. Without --yes this is a dry run.
<username> comes from \`ticktick-axi project members <projectId>\`; it is checked before anything is sent.
Assigning to the current assignee is a no-op.
examples:
  ticktick-axi project members <projectId>
  ticktick-axi assign <projectId> <taskId> member@example.com
  ticktick-axi assign <projectId> <taskId> member@example.com --yes
`;

export const UNASSIGN_HELP = `usage: ticktick-axi unassign <projectId> <taskId> [--yes]
Removes a task's assignee. Without --yes this is a dry run. A task TickTick reports as unassigned is a no-op.
examples:
  ticktick-axi unassign <projectId> <taskId>
  ticktick-axi unassign <projectId> <taskId> --yes
`;

const RENAMED = {
  ...GATE,
  user: "The username is the third argument: assign <projectId> <taskId> <username>",
  to: "The username is the third argument: assign <projectId> <taskId> <username>",
  none: "Use `ticktick-axi unassign <projectId> <taskId>`",
};

/** The assignee as TickTick reports it; absent, null and "" give undefined. */
function assigneeOf(t: AssignedTask | null): string | undefined {
  const v = t?.assigneeUsername;
  return typeof v === "string" && v ? v : undefined;
}

export async function assignCommand(args: string[]) {
  const p = parseArgs(args, { bool: ["yes"], renamed: RENAMED }, "assign");
  const [projectId, taskId, rawUser] = expectPositionals(
    p,
    3,
    "ticktick-axi assign <projectId> <taskId> <username> [--yes]",
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  const wanted = rawUser.trim();
  if (!wanted) throw usage("The username cannot be empty");
  const membersHint = `Run \`ticktick-axi project members ${projectId}\` to list usernames`;

  const client = getClient();
  const t: AssignedTask = await api.getTask(client, projectId, taskId);
  const raw = await apiOrg.projectMembers(client, projectId);
  const members = Array.isArray(raw) ? raw : [];
  const member =
    members.find((m) => m.username === wanted) ??
    members.find(
      (m) => (m.username ?? "").toLowerCase() === wanted.toLowerCase(),
    );
  if (!member?.username) {
    throw fail(
      "NOT_FOUND",
      members.length
        ? `${wanted} is not a member of project ${projectId}`
        : `Project ${projectId} has no members to assign to (it is not shared)`,
      membersHint,
    );
  }
  const username = member.username;
  const task = { id: taskId, title: t.title ?? "" };
  const current = assigneeOf(t);
  if (current === username) {
    return {
      task: { ...task, result: `already assigned to ${username} (no-op)` },
    };
  }
  const change = `assignee: ${current ?? "none reported"} -> ${username}${member.displayName ? ` (${member.displayName})` : ""}`;
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      task,
      would_change: change,
      help: [
        confirmHint(["assign"], [projectId, taskId, username], "assign it"),
      ],
    };
  }
  const updated = await apiOrg.assignTask(client, projectId, taskId, username);
  return {
    assigned: { ...task, assignee: assigneeOf(updated) ?? username },
    help: [`Run \`ticktick-axi task ${projectId} ${taskId}\` to view it`],
  };
}

export async function unassignCommand(args: string[]) {
  const p = parseArgs(args, { bool: ["yes"], renamed: GATE }, "unassign");
  const [projectId, taskId] = expectPositionals(
    p,
    2,
    "ticktick-axi unassign <projectId> <taskId> [--yes]",
  );
  validateId(projectId, "project id");
  validateId(taskId, "task id");
  const client = getClient();
  const t: AssignedTask = await api.getTask(client, projectId, taskId);
  const task = { id: taskId, title: t.title ?? "" };
  const current = assigneeOf(t);
  // The live API leaves the field out when a task has no assignee, so only an
  // explicit null or "" is a sure no-op; a missing field is "not reported".
  if (!current && t && "assigneeUsername" in t) {
    return { task: { ...task, result: "has no assignee (no-op)" } };
  }
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      task,
      would_change: `assignee: ${current ?? "none reported by TickTick"} -> none`,
      help: [confirmHint(["unassign"], [projectId, taskId], "unassign it")],
    };
  }
  await apiOrg.unassignTask(client, projectId, taskId);
  return {
    unassigned: { ...task, was: current ?? "none reported" },
    help: [`Run \`ticktick-axi task ${projectId} ${taskId}\` to view it`],
  };
}
