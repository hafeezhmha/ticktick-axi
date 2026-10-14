import { bool, expectPositionals, parseArgs, str } from "../args.js";
import { api, getClient, type Project } from "../api.js";
import { apiOrg, type ProjectGroup } from "../api-org.js";
import { fail, goneResult, orGone, usage } from "../errors.js";
import type { TickTickClient } from "../http.js";
import {
  checkId,
  confirmHint,
  dispatch,
  GATE,
  GROUP_IDS_HINT,
  nameArg,
} from "./org-common.js";

/** Documented maximum length of a project group name. */
export const GROUP_NAME_MAX = 64;

export const GROUPS_HELP = `usage: ticktick-axi groups
Lists project groups (folders): id, name, and how many projects each holds.
examples:
  ticktick-axi groups
`;

export const GROUP_HELP = `usage: ticktick-axi group <create|edit|delete> ... [--yes]
create "<name>"                   new project group (folder), up to ${GROUP_NAME_MAX} characters
edit <groupId> --name "<name>"    rename it
delete <groupId>                  delete it (the preview lists the projects in it)
Ids come from \`ticktick-axi groups\`. Without --yes all three are dry runs.
The Open API documents no way to move a project into or out of a group.
examples:
  ticktick-axi group create "Home"
  ticktick-axi group edit <groupId> --name "Household" --yes
  ticktick-axi group delete <groupId>
`;

async function loadGroups(client: TickTickClient): Promise<ProjectGroup[]> {
  const raw = await apiOrg.listGroups(client);
  return Array.isArray(raw) ? raw : [];
}

async function loadProjects(client: TickTickClient): Promise<Project[]> {
  const raw = await api.listProjects(client);
  return Array.isArray(raw) ? raw : [];
}

export async function groupsCommand(args: string[]) {
  const p = parseArgs(args, {}, "groups");
  if (p.positionals.length) {
    throw usage(
      `unexpected argument "${p.positionals[0]}"`,
      "Run `ticktick-axi groups` with no arguments",
    );
  }
  const client = getClient();
  const groups = await loadGroups(client);
  const create =
    'Run `ticktick-axi group create "<name>"` to preview adding one';
  if (groups.length === 0) {
    return { groups: "0 project groups found", help: [create] };
  }
  const projects = await loadProjects(client);
  const inGroup = (id: string) =>
    projects.filter((x) => x.groupId === id).length;
  const sorted = [...groups].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  return {
    count: `${groups.length} project group(s)`,
    groups: sorted.map((g) => ({
      id: g.id,
      name: g.name ?? "",
      projects: inGroup(g.id),
    })),
    help: [
      "Run `ticktick-axi project show <projectId>` to see which group a project is in",
      create,
    ],
  };
}

export async function groupCommand(args: string[]) {
  return dispatch(
    "group",
    args,
    { create: createGroup, edit: editGroup, delete: deleteGroup },
    {
      list: "To list groups run `ticktick-axi groups`",
      rename: 'Use `ticktick-axi group edit <groupId> --name "<name>"`',
      remove: "Use `ticktick-axi group delete <groupId>`",
    },
  );
}

async function findGroup(
  client: TickTickClient,
  id: string,
): Promise<ProjectGroup> {
  const g = (await loadGroups(client)).find((x) => x.id === id);
  if (!g) throw fail("NOT_FOUND", `No project group ${id}`, GROUP_IDS_HINT);
  return g;
}

async function createGroup(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes"],
      renamed: {
        ...GATE,
        name: 'The name is the first argument: group create "<name>"',
      },
    },
    "group create",
  );
  const [raw] = expectPositionals(
    p,
    1,
    'ticktick-axi group create "<name>" [--yes]',
  );
  const name = nameArg(raw, "group name", GROUP_NAME_MAX);
  const client = getClient();
  if (!bool(p, "yes")) {
    const same = (await loadGroups(client)).filter(
      (g) => (g.name ?? "").toLowerCase() === name.toLowerCase(),
    );
    const out: Record<string, unknown> = {
      dry_run: "nothing was sent",
      would_create: { name },
    };
    if (same.length) {
      out.note = `a group with this name already exists (${same.map((g) => g.id).join(", ")})`;
    }
    out.help = [confirmHint(["group", "create"], args, "create it")];
    return out;
  }
  const g = await apiOrg.createGroup(client, name);
  return {
    created: { id: g?.id ?? "(unknown)", name: g?.name ?? name },
    help: ["Run `ticktick-axi groups` to list groups"],
  };
}

async function editGroup(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes"],
      value: ["name"],
      renamed: { ...GATE, title: "Use --name <text>" },
    },
    "group edit",
  );
  const [raw] = expectPositionals(
    p,
    1,
    'ticktick-axi group edit <groupId> --name "<name>" [--yes]',
  );
  const id = checkId(raw, "group id", GROUP_IDS_HINT);
  const nameRaw = str(p, "name");
  if (nameRaw === undefined) {
    throw usage(
      "--name is required (a group has nothing else to change)",
      `Run \`ticktick-axi group edit ${id} --name "<name>"\``,
    );
  }
  const name = nameArg(nameRaw, "--name", GROUP_NAME_MAX);
  const client = getClient();
  const g = await findGroup(client, id);
  const ref = { id, name: g.name ?? "" };
  if (g.name === name) {
    return { group: { ...ref, result: "already has that name (no-op)" } };
  }
  const change = { field: "name", from: g.name ?? "", to: name };
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      group: ref,
      changes: [change],
      help: [confirmHint(["group", "edit"], args, "rename it")],
    };
  }
  const updated = await apiOrg.updateGroup(client, id, name);
  return {
    updated: { id, name: updated?.name ?? name },
    changes: [change],
    help: ["Run `ticktick-axi groups` to list groups"],
  };
}

async function deleteGroup(args: string[]) {
  const p = parseArgs(args, { bool: ["yes"], renamed: GATE }, "group delete");
  const [raw] = expectPositionals(
    p,
    1,
    "ticktick-axi group delete <groupId> [--yes]",
  );
  const id = checkId(raw, "group id", GROUP_IDS_HINT);
  const client = getClient();
  const g = await orGone(findGroup(client, id));
  if (!g) return goneResult(`project group ${id}`, GROUP_IDS_HINT);
  const ref = { id, name: g.name ?? "" };
  const inside = (await loadProjects(client)).filter((x) => x.groupId === id);
  if (!bool(p, "yes")) {
    const out: Record<string, unknown> = {
      dry_run: "nothing was sent",
      would_delete: ref,
    };
    if (inside.length) {
      out.projects_in_group = inside.map((x) => ({
        id: x.id,
        name: x.name ?? "",
      }));
      out.note = `${inside.length} project(s) are in this group. The Open API docs do not say whether they are kept (ungrouped) or deleted with it; if unsure, move them out in the TickTick app first`;
    } else {
      out.projects_in_group = "0 projects in this group";
    }
    out.help = [confirmHint(["group", "delete"], args, "delete it")];
    return out;
  }
  await apiOrg.deleteGroup(client, id);
  return {
    deleted: ref,
    help: ["Run `ticktick-axi groups` to see the groups left"],
  };
}
