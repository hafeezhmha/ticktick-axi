import {
  bool,
  expectPositionals,
  parseArgs,
  str,
  type FlagSpec,
  type ParsedArgs,
} from "../args.js";
import { api, getClient, type Project } from "../api.js";
import { apiOrg, type ProjectFields, type ProjectInfo } from "../api-org.js";
import { usage } from "../errors.js";
import type { TickTickClient } from "../http.js";
import {
  checkId,
  confirmHint,
  dispatch,
  GATE,
  nameArg,
  PROJECT_IDS_HINT,
} from "./org-common.js";

export const PROJECT_HELP = `usage: ticktick-axi project <show|create|edit|delete|members> ... [--yes]
One project (list). \`ticktick-axi projects\` lists them all.
show <projectId>                 its settings, open-task and column counts
create "<name>" [flags]          new project
edit <projectId> [flags]         change name, color, view, kind or sort order
delete <projectId>               delete it, with its tasks
members <projectId>              who it is shared with (usernames for \`assign\`)
create and edit flags:
  --name <text>        new name (edit only; for create the name is the argument)
  --color <hex>        e.g. F18181 or "#F18181" (quote a leading #: the shell treats it as a comment)
  --view <mode>        list | kanban | timeline
  --kind <kind>        task | note
  --sort-order <n>     position among projects (integer)
create, edit and delete are dry runs until --yes.
examples:
  ticktick-axi project show <projectId>
  ticktick-axi project create "Trip to Goa" --view kanban --color F18181
  ticktick-axi project edit <projectId> --name "Trip to Goa 2026" --yes
  ticktick-axi project delete <projectId>
`;

const VIEWS = ["list", "kanban", "timeline"];
const KINDS = ["task", "note"];

const FIELD_FLAGS = ["color", "view", "kind", "sort-order"];
const FIELD_RENAMED = {
  ...GATE,
  colour: "Use --color <hex>",
  "view-mode": "Use --view list|kanban|timeline",
  viewmode: "Use --view list|kanban|timeline",
  type: "Use --kind task|note",
  order: "Use --sort-order <n>",
  group:
    "The Open API documents no way to put a project in a group; do it in the TickTick app",
};

const CREATE_SPEC: FlagSpec = {
  bool: ["yes"],
  value: FIELD_FLAGS,
  renamed: {
    ...FIELD_RENAMED,
    name: 'The name is the first argument: project create "<name>"',
  },
};

const EDIT_SPEC: FlagSpec = {
  bool: ["yes"],
  value: ["name", ...FIELD_FLAGS],
  renamed: { ...FIELD_RENAMED, title: "Use --name <text>" },
};

export async function projectCommand(args: string[]) {
  return dispatch(
    "project",
    args,
    {
      show: showProject,
      create: createProject,
      edit: editProject,
      delete: deleteProject,
      members: projectMembers,
    },
    {
      list: "To list projects run `ticktick-axi projects`",
      update: "Use `ticktick-axi project edit <projectId> ...`",
      rename: 'Use `ticktick-axi project edit <projectId> --name "<name>"`',
      remove: "Use `ticktick-axi project delete <projectId>`",
    },
  );
}

function projectId(raw: string): string {
  return checkId(raw, "project id", PROJECT_IDS_HINT);
}

export function parseColor(input: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(input.trim());
  if (!m) {
    throw usage(
      `--color "${input}" is not a hex color`,
      'Use 6 hex digits, e.g. --color F18181 or --color "#F18181"',
    );
  }
  return `#${m[1].toUpperCase()}`;
}

function oneOf(input: string, flag: string, allowed: string[]): string {
  const v = input.trim().toLowerCase();
  if (!allowed.includes(v)) {
    throw usage(
      `${flag} "${input}" is not valid`,
      `Use one of: ${allowed.join(", ")}`,
    );
  }
  return v;
}

/** Read the project field flags into an API body (only those given). */
function fieldFlags(p: ParsedArgs): ProjectFields {
  const out: ProjectFields = {};
  const color = str(p, "color");
  if (color !== undefined) out.color = parseColor(color);
  const view = str(p, "view");
  if (view !== undefined) out.viewMode = oneOf(view, "--view", VIEWS);
  const kind = str(p, "kind");
  if (kind !== undefined) {
    out.kind = oneOf(kind, "--kind", KINDS).toUpperCase();
  }
  const order = str(p, "sort-order");
  if (order !== undefined) {
    if (!/^-?\d{1,15}$/.test(order.trim())) {
      throw usage(`--sort-order must be a whole number, got "${order}"`);
    }
    out.sortOrder = Number(order.trim());
  }
  return out;
}

/** A compact, stable view of a project's settings. */
function projectView(pr: ProjectInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: pr.id,
    name: pr.name ?? "",
    kind: (pr.kind ?? "TASK").toLowerCase(),
    view: pr.viewMode ?? "list",
  };
  if (pr.color) out.color = pr.color;
  if (pr.closed) out.closed = true;
  if (pr.groupId) out.groupId = pr.groupId;
  if (pr.permission) out.permission = pr.permission;
  return out;
}

/** Open-task and column counts from GET /project/{id}/data. */
async function contents(client: TickTickClient, id: string) {
  const data = await api.projectData(client, id);
  const tasks = Array.isArray(data?.tasks) ? data.tasks.length : 0;
  const raw = (data as { columns?: unknown } | null)?.columns;
  const columns = Array.isArray(raw) ? raw.length : 0;
  return { tasks, columns };
}

async function showProject(args: string[]) {
  const p = parseArgs(args, {}, "project show");
  const [raw] = expectPositionals(
    p,
    1,
    "ticktick-axi project show <projectId>",
  );
  const id = projectId(raw);
  const client = getClient();
  const pr = await apiOrg.getProject(client, id);
  const { tasks, columns } = await contents(client, id);
  const help = [
    `Run \`ticktick-axi tasks --project ${id}\` to list its open tasks`,
  ];
  if (columns || pr?.viewMode === "kanban") {
    help.push(`Run \`ticktick-axi columns ${id}\` to list its columns`);
  }
  help.push(
    `Run \`ticktick-axi project edit ${id} --name "<name>"\` to preview a change`,
  );
  return {
    project: { ...projectView({ ...pr, id }), open_tasks: tasks, columns },
    help,
  };
}

/** Projects with this name (case-insensitive), to flag a likely duplicate. */
async function sameName(
  client: TickTickClient,
  name: string,
  except?: string,
): Promise<Project[]> {
  const raw = await api.listProjects(client);
  const all: Project[] = Array.isArray(raw) ? raw : [];
  const want = name.toLowerCase();
  return all.filter(
    (x) => x.id !== except && (x.name ?? "").toLowerCase() === want,
  );
}

async function createProject(args: string[]) {
  const p = parseArgs(args, CREATE_SPEC, "project create");
  const [raw] = expectPositionals(
    p,
    1,
    'ticktick-axi project create "<name>" [--color <hex>] [--view <mode>] [--kind <kind>] [--yes]',
  );
  const name = nameArg(raw, "project name", 1000);
  const body = { name, ...fieldFlags(p) };
  const preview: Record<string, unknown> = {
    name,
    kind: (body.kind ?? "TASK").toLowerCase(),
    view: body.viewMode ?? "list",
  };
  if (body.color) preview.color = body.color;
  if (body.sortOrder !== undefined) preview.sortOrder = body.sortOrder;

  const client = getClient();
  if (!bool(p, "yes")) {
    const dupes = await sameName(client, name);
    const out: Record<string, unknown> = {
      dry_run: "nothing was sent",
      would_create: preview,
    };
    if (dupes.length) {
      out.note = `a project with this name already exists (${dupes.map((d) => d.id).join(", ")}); TickTick allows duplicates`;
    }
    out.help = [confirmHint(["project", "create"], args, "create it")];
    return out;
  }
  const created = await apiOrg.createProject(client, body);
  const id = created?.id ?? "(unknown)";
  return {
    created: projectView({ ...body, ...created, id }),
    help: [
      `Run \`ticktick-axi create "<title>" --project ${id}\` to preview adding a task`,
      `Run \`ticktick-axi project show ${id}\` to view it`,
    ],
  };
}

async function editProject(args: string[]) {
  const p = parseArgs(args, EDIT_SPEC, "project edit");
  const [raw] = expectPositionals(
    p,
    1,
    "ticktick-axi project edit <projectId> [--name ...] [--color ...] [--view ...] [--kind ...] [--sort-order ...] [--yes]",
  );
  const id = projectId(raw);
  const want = fieldFlags(p);
  const nameRaw = str(p, "name");
  if (nameRaw !== undefined) want.name = nameArg(nameRaw, "--name", 1000);
  if (Object.keys(want).length === 0) {
    throw usage(
      "Nothing to change",
      "Pass at least one of --name, --color, --view, --kind, --sort-order",
    );
  }

  const client = getClient();
  const cur = await apiOrg.getProject(client, id);
  const changes: Array<{ field: string; from: string; to: string }> = [];
  const body: ProjectFields = {};
  const compare = (
    key: keyof ProjectFields,
    label: string,
    from: string | number | undefined,
    norm: (v: string | number) => string = String,
  ) => {
    const to = want[key];
    if (to === undefined) return;
    if (from !== undefined && norm(from) === norm(to)) return;
    changes.push({
      field: label,
      from: from === undefined ? "none" : String(from),
      to: String(to),
    });
    (body as Record<string, unknown>)[key] = to;
  };
  compare("name", "name", cur?.name);
  compare("color", "color", cur?.color, (v) => String(v).toUpperCase());
  compare("viewMode", "view", cur?.viewMode ?? "list");
  compare("kind", "kind", cur?.kind ?? "TASK", (v) => String(v).toUpperCase());
  compare("sortOrder", "sortOrder", cur?.sortOrder);

  const ref = { id, name: cur?.name ?? "" };
  if (changes.length === 0) {
    return { project: { ...ref, result: "no changes (already as requested)" } };
  }
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      project: ref,
      changes,
      help: [confirmHint(["project", "edit"], args, "apply it")],
    };
  }
  const updated = await apiOrg.updateProject(client, id, body);
  return {
    updated: { id, name: updated?.name ?? body.name ?? ref.name },
    changes,
    help: [`Run \`ticktick-axi project show ${id}\` to view it`],
  };
}

async function deleteProject(args: string[]) {
  const p = parseArgs(args, { bool: ["yes"], renamed: GATE }, "project delete");
  const [raw] = expectPositionals(
    p,
    1,
    "ticktick-axi project delete <projectId> [--yes]",
  );
  const id = projectId(raw);
  if (id.startsWith("inbox")) {
    throw usage(
      "The Inbox cannot be deleted",
      "Run `ticktick-axi projects` to list the projects that can",
    );
  }
  const client = getClient();
  const pr = await apiOrg.getProject(client, id);
  const { tasks, columns } = await contents(client, id);
  const ref = {
    id,
    name: pr?.name ?? "",
    kind: (pr?.kind ?? "TASK").toLowerCase(),
  };
  if (!bool(p, "yes")) {
    const goes = [
      `${tasks} open task(s) and its completed tasks`,
      ...(columns ? [`${columns} column(s)`] : []),
    ];
    return {
      dry_run: "nothing was sent",
      would_delete: ref,
      goes_with_it: goes.join(", "),
      help: [
        ...(tasks
          ? [
              `Run \`ticktick-axi tasks --project ${id}\` to review its tasks first, or \`ticktick-axi move ${id} <taskId> --to <projectId>\` to keep one`,
            ]
          : []),
        confirmHint(["project", "delete"], args, "delete it and its tasks"),
      ],
    };
  }
  await apiOrg.deleteProject(client, id);
  return {
    deleted: ref,
    with_it: `${tasks} open task(s)${columns ? `, ${columns} column(s)` : ""}`,
    help: ["Run `ticktick-axi projects` to see the projects left"],
  };
}

async function projectMembers(args: string[]) {
  const p = parseArgs(args, {}, "project members");
  const [raw] = expectPositionals(
    p,
    1,
    "ticktick-axi project members <projectId>",
  );
  const id = projectId(raw);
  const res = await apiOrg.projectMembers(getClient(), id);
  const members = Array.isArray(res) ? res : [];
  if (members.length === 0) {
    return {
      members: "0 members found (the project is not shared)",
      help: [`Run \`ticktick-axi project show ${id}\` to view the project`],
    };
  }
  return {
    count: `${members.length} member(s)`,
    members: members.map((m) => ({
      username: m.username ?? "",
      name: m.displayName ?? "",
      self: !!m.self,
    })),
    help: [
      `Run \`ticktick-axi assign ${id} <taskId> <username>\` to preview assigning a task`,
    ],
  };
}
