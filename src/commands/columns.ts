import { bool, expectPositionals, parseArgs, str } from "../args.js";
import { getClient } from "../api.js";
import { apiOrg, type Column } from "../api-org.js";
import { fail, usage } from "../errors.js";
import type { TickTickClient } from "../http.js";
import {
  checkId,
  confirmHint,
  dispatch,
  GATE,
  nameArg,
  PROJECT_IDS_HINT,
} from "./org-common.js";

/** Documented maximum length of a column name. */
export const COLUMN_NAME_MAX = 1000;

export const COLUMNS_HELP = `usage: ticktick-axi columns <projectId>
Lists a project's columns (kanban sections), in board order: id and name.
examples:
  ticktick-axi columns <projectId>
`;

export const COLUMN_HELP = `usage: ticktick-axi column <create|edit> <projectId> ... [--yes]
create <projectId> "<name>"                  add a column (kanban section)
edit <projectId> <columnId> --name "<name>"  rename one (ids from \`ticktick-axi columns <projectId>\`)
Without --yes both are dry runs. The Open API documents no column delete; remove one in the
TickTick app.
examples:
  ticktick-axi column create <projectId> "Doing"
  ticktick-axi column edit <projectId> <columnId> --name "In progress" --yes
`;

async function loadColumns(
  client: TickTickClient,
  projectId: string,
): Promise<Column[]> {
  const raw = await apiOrg.listColumns(client, projectId);
  const cols = Array.isArray(raw) ? raw : [];
  return [...cols].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export async function columnsCommand(args: string[]) {
  const p = parseArgs(args, {}, "columns");
  const [raw] = expectPositionals(p, 1, "ticktick-axi columns <projectId>");
  const id = checkId(raw, "project id", PROJECT_IDS_HINT);
  const cols = await loadColumns(getClient(), id);
  const create = `Run \`ticktick-axi column create ${id} "<name>"\` to preview adding one`;
  if (cols.length === 0) {
    return {
      columns: "0 columns found in this project",
      help: [
        create,
        `Columns appear in kanban view (\`ticktick-axi project edit ${id} --view kanban\` if the project is not)`,
      ],
    };
  }
  return {
    count: `${cols.length} column(s)`,
    columns: cols.map((c) => ({ id: c.id, name: c.name ?? "" })),
    help: [
      `Run \`ticktick-axi column edit ${id} <columnId> --name "<name>"\` to preview renaming one`,
      create,
    ],
  };
}

export async function columnCommand(args: string[]) {
  return dispatch(
    "column",
    args,
    { create: createColumn, edit: editColumn },
    {
      list: "To list columns run `ticktick-axi columns <projectId>`",
      rename:
        'Use `ticktick-axi column edit <projectId> <columnId> --name "<name>"`',
      delete:
        "The Open API documents no column delete; remove it in the TickTick app",
    },
  );
}

async function createColumn(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes"],
      renamed: {
        ...GATE,
        name: 'The name is an argument: column create <projectId> "<name>"',
      },
    },
    "column create",
  );
  const [rawId, rawName] = expectPositionals(
    p,
    2,
    'ticktick-axi column create <projectId> "<name>" [--yes]',
  );
  const id = checkId(rawId, "project id", PROJECT_IDS_HINT);
  const name = nameArg(rawName, "column name", COLUMN_NAME_MAX);
  const client = getClient();
  if (!bool(p, "yes")) {
    const pr = await apiOrg.getProject(client, id);
    const cols = await loadColumns(client, id);
    const out: Record<string, unknown> = {
      dry_run: "nothing was sent",
      project: { id, name: pr?.name ?? "", view: pr?.viewMode ?? "list" },
      would_create: { name, position: `column ${cols.length + 1}` },
    };
    const notes: string[] = [];
    const same = cols.filter(
      (c) => (c.name ?? "").toLowerCase() === name.toLowerCase(),
    );
    if (same.length) {
      notes.push(
        `a column with this name already exists (${same.map((c) => c.id).join(", ")})`,
      );
    }
    if ((pr?.viewMode ?? "list") !== "kanban") {
      notes.push(
        `columns show only in kanban view; this project is in ${pr?.viewMode ?? "list"} view`,
      );
    }
    notes.push(
      "the Open API cannot delete a column; it stays until removed in the TickTick app",
    );
    out.notes = notes;
    out.help = [confirmHint(["column", "create"], args, "create it")];
    return out;
  }
  const c = await apiOrg.createColumn(client, id, name);
  return {
    created: { id: c?.id ?? "(unknown)", name: c?.name ?? name },
    help: [`Run \`ticktick-axi columns ${id}\` to list the project's columns`],
  };
}

async function editColumn(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes"],
      value: ["name"],
      renamed: { ...GATE, title: "Use --name <text>" },
    },
    "column edit",
  );
  const [rawId, rawCol] = expectPositionals(
    p,
    2,
    'ticktick-axi column edit <projectId> <columnId> --name "<name>" [--yes]',
  );
  const id = checkId(rawId, "project id", PROJECT_IDS_HINT);
  const listHint = `Run \`ticktick-axi columns ${id}\` to list column ids`;
  const colId = checkId(rawCol, "column id", listHint);
  const nameRaw = str(p, "name");
  if (nameRaw === undefined) {
    throw usage(
      "--name is required (a column has nothing else to change)",
      `Run \`ticktick-axi column edit ${id} ${colId} --name "<name>"\``,
    );
  }
  const name = nameArg(nameRaw, "--name", COLUMN_NAME_MAX);
  const client = getClient();
  const col = (await loadColumns(client, id)).find((c) => c.id === colId);
  if (!col) {
    throw fail("NOT_FOUND", `No column ${colId} in project ${id}`, listHint);
  }
  const ref = { id: colId, name: col.name ?? "" };
  if (col.name === name) {
    return { column: { ...ref, result: "already has that name (no-op)" } };
  }
  const change = { field: "name", from: col.name ?? "", to: name };
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      column: ref,
      changes: [change],
      help: [confirmHint(["column", "edit"], args, "rename it")],
    };
  }
  const updated = await apiOrg.updateColumn(client, id, colId, name);
  return {
    updated: { id: colId, name: updated?.name ?? name },
    changes: [change],
    help: [`Run \`ticktick-axi columns ${id}\` to list the project's columns`],
  };
}
