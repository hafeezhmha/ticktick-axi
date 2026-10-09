import { usage } from "./errors.js";

export interface FlagSpec {
  /** Flags that take no value (`--yes`). */
  bool?: string[];
  /** Flags that take exactly one value (`--project <id>`). */
  value?: string[];
  /** Value flags that may repeat (`--tag a --tag b`). */
  repeat?: string[];
  /** Old or commonly-guessed names mapped to a targeted hint. */
  renamed?: Record<string, string>;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
  multi: Record<string, string[]>;
}

/**
 * Strict argument parser. Unknown flags are rejected by name with the
 * command's valid flags listed inline (AXI: fail loud on unrecognized input),
 * so an agent never gets output it believes was filtered when it was not.
 *
 * Accepts `--flag value`, `--flag=value`, and `--` to end flag parsing.
 */
export function parseArgs(
  args: string[],
  spec: FlagSpec,
  command: string,
): ParsedArgs {
  const bool = new Set(spec.bool ?? []);
  const value = new Set(spec.value ?? []);
  const repeat = new Set(spec.repeat ?? []);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const multi: Record<string, string[]> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-" || /^-\d/.test(arg)) {
      positionals.push(arg);
      continue;
    }
    if (!arg.startsWith("--")) {
      throw unknownFlag(arg, spec, command);
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    const name = eq >= 0 ? body.slice(0, eq) : body;
    const inline = eq >= 0 ? body.slice(eq + 1) : undefined;

    if (bool.has(name)) {
      if (inline !== undefined) {
        throw usage(
          `--${name} does not take a value`,
          `Run \`ticktick-axi ${command} ... --${name}\``,
        );
      }
      flags[name] = true;
      continue;
    }
    if (value.has(name) || repeat.has(name)) {
      let v = inline;
      if (v === undefined) {
        const next = args[i + 1];
        if (next === undefined || next.startsWith("--")) {
          throw usage(
            `--${name} needs a value`,
            `Run \`ticktick-axi ${command} --help\` for the expected format`,
          );
        }
        v = next;
        i++;
      }
      if (repeat.has(name)) {
        (multi[name] ??= []).push(v);
      } else if (name in flags) {
        throw usage(`--${name} was given more than once`);
      } else {
        flags[name] = v;
      }
      continue;
    }
    throw unknownFlag(arg, spec, command);
  }
  return { positionals, flags, multi };
}

function unknownFlag(arg: string, spec: FlagSpec, command: string) {
  const name = arg.replace(/^-+/, "").split("=")[0];
  const hint = spec.renamed?.[name];
  if (hint) return usage(`unknown flag --${name} for \`${command}\``, hint);
  const valid = [
    ...(spec.bool ?? []),
    ...(spec.value ?? []),
    ...(spec.repeat ?? []),
  ]
    .map((f) => `--${f}`)
    .join(", ");
  return usage(
    `unknown flag ${arg.split("=")[0]} for \`${command}\``,
    valid
      ? `valid flags for \`${command}\`: ${valid} (--help always allowed)`
      : `\`${command}\` takes no flags (--help always allowed)`,
  );
}

/** Read a string flag, or undefined when absent. */
export function str(parsed: ParsedArgs, name: string): string | undefined {
  const v = parsed.flags[name];
  return typeof v === "string" ? v : undefined;
}

export function bool(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}

/** Parse a bounded positive integer flag. */
export function intFlag(
  parsed: ParsedArgs,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = str(parsed, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw usage(`--${name} must be a whole number, got "${raw}"`);
  }
  const n = Number.parseInt(raw, 10);
  if (n < min || n > max) {
    throw usage(`--${name} must be between ${min} and ${max}, got ${n}`);
  }
  return n;
}

/** Comma-separated and/or repeated values, trimmed and de-duplicated. */
export function listValues(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    for (const part of v.split(",")) {
      const t = part.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** Require an exact number of positionals, with a usage hint on mismatch. */
export function expectPositionals(
  parsed: ParsedArgs,
  count: number,
  usageLine: string,
): string[] {
  if (parsed.positionals.length !== count) {
    const what =
      parsed.positionals.length < count
        ? "missing argument"
        : `unexpected argument "${parsed.positionals[count]}"`;
    throw usage(`${what}`, `Usage: ${usageLine}`);
  }
  return parsed.positionals;
}

/** Quote an argument for display in a copy-pasteable shell command. */
export function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
