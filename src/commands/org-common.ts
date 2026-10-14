import { shellQuote } from "../args.js";
import { validateId } from "../api.js";
import { usage } from "../errors.js";

/** Shared pieces of the project, group, column, tag, assign and batch commands. */

export const GATE = {
  confirm: "--confirm is not a flag; add --yes to apply the change",
  execute: "--execute is not a flag; add --yes to apply the change",
  force: "--force is not a flag; add --yes to apply the change",
  "dry-run": "Dry run is the default; omit --yes to preview",
  json: "Output is always TOON",
};

/** The exact command that applies a dry run (`words` are printed unquoted). */
export function confirmHint(
  words: string[],
  args: string[],
  verb: string,
): string {
  const line = ["ticktick-axi", ...words, ...args.map(shellQuote)].join(" ");
  return `Run \`${line} --yes\` to ${verb} (only after the person confirms)`;
}

/** `validateId`, with a hint that names the command listing this kind of id. */
export function checkId(value: string, label: string, hint: string): string {
  try {
    return validateId(value, label);
  } catch {
    throw usage(`invalid ${label} "${value}"`, hint);
  }
}

export const PROJECT_IDS_HINT =
  "Run `ticktick-axi projects` to list project ids";
export const GROUP_IDS_HINT = "Run `ticktick-axi groups` to list group ids";

/** Dispatch `<command> <sub> ...` to a handler, with a usage error otherwise. */
export function dispatch<T>(
  command: string,
  args: string[],
  handlers: Record<string, (rest: string[]) => Promise<T>>,
  hints: Record<string, string> = {},
): Promise<T> {
  const [sub, ...rest] = args;
  const handler = sub !== undefined ? handlers[sub] : undefined;
  if (handler && Object.hasOwn(handlers, sub)) return handler(rest);
  const subs = Object.keys(handlers).join(", ");
  throw usage(
    sub
      ? `unknown ${command} subcommand "${sub}"`
      : `${command} needs a subcommand`,
    ...(sub && hints[sub] ? [hints[sub]] : []),
    `Use one of: ${subs} (see \`ticktick-axi ${command} --help\`)`,
  );
}

/** A required, trimmed, length-bounded name. */
export function nameArg(raw: string, what: string, max: number): string {
  const v = raw.trim();
  if (!v) throw usage(`The ${what} cannot be empty`);
  if (v.length > max) {
    throw usage(
      `The ${what} is ${v.length} characters; TickTick allows at most ${max}`,
    );
  }
  return v;
}
