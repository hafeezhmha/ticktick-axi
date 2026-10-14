import { bool, expectPositionals, parseArgs, shellQuote } from "../args.js";
import { api, getClient, validateId, type Task } from "../api.js";
import { fail, usage } from "../errors.js";
import { truncate } from "../format.js";

type Item = NonNullable<Task["items"]>[number];

const GATE = {
  confirm: "--confirm is not a flag; add --yes to apply the change",
  force: "--force is not a flag; add --yes to apply the change",
  "dry-run": "Dry run is the default; omit --yes to preview",
};

export const ITEM_HELP = `usage: ticktick-axi item <add|done|undo|rename|remove> <projectId> <taskId> ... [--yes]
Changes one checklist item (subtask) of a task. Without --yes it is a dry run.
add <projectId> <taskId> "<title>"              add an item at the end
done <projectId> <taskId> <item>                tick it off
undo <projectId> <taskId> <item>                untick it
rename <projectId> <taskId> <item> "<title>"    change its title
remove <projectId> <taskId> <item>              remove it
<item> is its number in \`ticktick-axi task <projectId> <taskId>\` (1, 2, ...) or its id.
TickTick replaces the whole checklist on every change, so ticktick-axi sends the current
list back with only your change; preview first if someone else may be editing the task.
examples:
  ticktick-axi item add <projectId> <taskId> "Pack the charger"
  ticktick-axi item done <projectId> <taskId> 2 --yes
`;

const OPS = ["add", "done", "undo", "rename", "remove"] as const;
type Op = (typeof OPS)[number];
const ARITY: Record<Op, number> = {
  add: 3,
  done: 3,
  undo: 3,
  rename: 4,
  remove: 3,
};
const SHAPE: Record<Op, string> = {
  add: 'add <projectId> <taskId> "<title>"',
  done: "done <projectId> <taskId> <item>",
  undo: "undo <projectId> <taskId> <item>",
  rename: 'rename <projectId> <taskId> <item> "<title>"',
  remove: "remove <projectId> <taskId> <item>",
};

export async function itemCommand(args: string[]) {
  const [sub, ...rest] = args;
  if (!OPS.includes(sub as Op)) {
    throw usage(
      sub ? `unknown item subcommand "${sub}"` : "item needs a subcommand",
      `Use one of: ${OPS.join(", ")} (see \`ticktick-axi item --help\`)`,
    );
  }
  const op = sub as Op;
  const p = parseArgs(rest, { bool: ["yes"], renamed: GATE }, `item ${op}`);
  const pos = expectPositionals(p, ARITY[op], `ticktick-axi item ${SHAPE[op]}`);
  const [projectId, taskId] = pos;
  validateId(projectId, "project id");
  validateId(taskId, "task id");

  const client = getClient();
  const t = await api.getTask(client, projectId, taskId);
  const items: Item[] = (t.items ?? []).map((i) => ({ ...i }));
  const task = { id: taskId, title: t.title ?? "" };

  let change: string;
  let next: Item[];
  if (op === "add") {
    const title = pos[2].trim();
    if (!title) throw usage("The item title cannot be empty");
    next = [...items, { title, status: 0 }];
    change = `add item ${next.length}: ${truncate(title, 100).text}`;
  } else {
    const at = resolveItem(items, pos[2], projectId, taskId);
    const it = items[at];
    const label = `item ${at + 1} (${truncate(it.title ?? "", 60).text})`;
    if (op === "done" || op === "undo") {
      const want = op === "done" ? 1 : 0;
      if ((it.status ?? 0) === want) {
        return {
          task,
          result: `${label} is already ${want ? "done" : "not done"} (no-op)`,
        };
      }
      next = items.map((x, i) => (i === at ? { ...x, status: want } : x));
      change = `${label}: ${want ? "not done -> done" : "done -> not done"}`;
    } else if (op === "rename") {
      const title = pos[3].trim();
      if (!title) throw usage("The item title cannot be empty");
      if (title === it.title) {
        return { task, result: `${label} already has that title (no-op)` };
      }
      next = items.map((x, i) => (i === at ? { ...x, title } : x));
      change = `${label} -> ${truncate(title, 60).text}`;
    } else {
      next = items.filter((_, i) => i !== at);
      change = `remove ${label}`;
    }
  }

  if (!bool(p, "yes")) {
    const line = ["ticktick-axi", "item", op, ...pos.map(shellQuote)].join(" ");
    return {
      dry_run: "nothing was sent",
      task,
      would_change: change,
      checklist_after: `${next.filter((i) => i.status === 1).length}/${next.length} done`,
      help: [
        `Run \`${line} --yes\` to apply it (only after the person confirms)`,
      ],
    };
  }
  const updated = await api.updateTask(client, taskId, {
    id: taskId,
    projectId,
    items: next,
  });
  const after = Array.isArray(updated?.items) ? updated.items : next;
  return {
    updated: task,
    change,
    checklist: `${after.filter((i) => i.status === 1).length}/${after.length} done`,
    help: [
      `Run \`ticktick-axi task ${projectId} ${taskId}\` to see the checklist`,
    ],
  };
}

function resolveItem(
  items: Item[],
  ref: string,
  projectId: string,
  taskId: string,
): number {
  const help = `Run \`ticktick-axi task ${projectId} ${taskId} --full\` to see item numbers and ids`;
  if (items.length === 0) {
    throw fail("NOT_FOUND", "This task has no checklist items", help);
  }
  if (/^\d+$/.test(ref)) {
    const n = Number(ref);
    if (n >= 1 && n <= items.length) return n - 1;
    throw usage(
      `There is no item ${n}; the checklist has ${items.length}`,
      help,
    );
  }
  const at = items.findIndex((i) => i.id === ref);
  if (at === -1)
    throw fail("NOT_FOUND", `No checklist item "${ref}" on this task`, help);
  return at;
}
