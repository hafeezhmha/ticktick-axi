import { bool, expectPositionals, parseArgs, shellQuote } from "../args.js";
import { getClient } from "../api.js";
import { apiOrg, type Tag } from "../api-org.js";
import { usage } from "../errors.js";
import { confirmHint, dispatch, GATE, nameArg } from "./org-common.js";

/** Documented maximum length of a tag name and label. */
export const TAG_MAX = 64;

export const TAGS_HELP = `usage: ticktick-axi tags [--full]
Lists your tags: name (what \`--tag\` filters take) and label (how TickTick shows it).
flags:
  --full   add color and type (personal or team)
examples:
  ticktick-axi tags
  ticktick-axi tasks --tag <name>
`;

export const TAG_HELP = `usage: ticktick-axi tag create "<label>" [--yes]
Creates a tag. The name is the label lowercased (TickTick requires that), up to ${TAG_MAX} characters.
Creating a tag that already exists is a no-op. The Open API documents no tag rename or delete,
so a new tag stays until removed in the TickTick app. To tag a task, use \`edit --tag\`
or \`create --tag\`.
examples:
  ticktick-axi tag create "Errands"
  ticktick-axi tag create "Errands" --yes
`;

export async function tagsCommand(args: string[]) {
  const p = parseArgs(args, { bool: ["full"] }, "tags");
  if (p.positionals.length) {
    throw usage(
      `unexpected argument "${p.positionals[0]}"`,
      "Run `ticktick-axi tasks --tag <name>` to list a tag's tasks",
    );
  }
  const raw = await apiOrg.listTags(getClient());
  const tags: Tag[] = Array.isArray(raw) ? raw : [];
  const create =
    'Run `ticktick-axi tag create "<label>"` to preview adding one';
  if (tags.length === 0) return { tags: "0 tags found", help: [create] };
  const full = bool(p, "full");
  const nested = tags.some((t) => t.parent);
  const sorted = [...tags].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  return {
    count: `${tags.length} tag(s)`,
    tags: sorted.map((t) => ({
      name: t.name ?? "",
      label: t.label ?? t.name ?? "",
      ...(nested ? { parent: t.parent ?? "" } : {}),
      ...(full
        ? {
            color: t.color ?? "",
            type: t.type === 2 ? "team" : "personal",
          }
        : {}),
    })),
    help: ["Run `ticktick-axi tasks --tag <name>` to list a tag's open tasks"],
  };
}

export async function tagCommand(args: string[]) {
  return dispatch(
    "tag",
    args,
    { create: createTag },
    {
      list: "To list tags run `ticktick-axi tags`",
      add: 'Use `ticktick-axi tag create "<label>"`',
      delete:
        "The Open API documents no tag delete; remove it in the TickTick app",
      rename:
        "The Open API documents no tag rename; rename it in the TickTick app",
    },
  );
}

async function createTag(args: string[]) {
  const p = parseArgs(
    args,
    {
      bool: ["yes"],
      renamed: {
        ...GATE,
        name: 'The label is the argument: tag create "<label>"',
        label: 'The label is the argument: tag create "<label>"',
        parent: "The Open API documents no parent for a new tag",
        color: "The Open API documents no color for a new tag",
      },
    },
    "tag create",
  );
  const [raw] = expectPositionals(
    p,
    1,
    'ticktick-axi tag create "<label>" [--yes]',
  );
  const label = nameArg(raw, "tag label", TAG_MAX);
  const name = label.toLowerCase();
  const client = getClient();
  const existing = await apiOrg.listTags(client);
  const found = (Array.isArray(existing) ? existing : []).find(
    (t) => (t.name ?? "").toLowerCase() === name,
  );
  if (found) {
    return {
      tag: {
        name: found.name ?? name,
        label: found.label ?? found.name ?? label,
        result: "already exists (no-op)",
      },
      help: [
        `Run \`ticktick-axi tasks --tag ${shellQuote(found.name ?? name)}\` to list its tasks`,
      ],
    };
  }
  if (!bool(p, "yes")) {
    return {
      dry_run: "nothing was sent",
      would_create: { name, label },
      note: "the Open API cannot rename or delete a tag; it stays until removed in the TickTick app",
      help: [confirmHint(["tag", "create"], args, "create it")],
    };
  }
  const t = await apiOrg.createTag(client, name, label);
  return {
    created: { name: t?.name ?? name, label: t?.label ?? label },
    help: [
      `Run \`ticktick-axi edit <projectId> <taskId> --tag ${shellQuote(name)}\` to preview tagging a task`,
    ],
  };
}
