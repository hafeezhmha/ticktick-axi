import { describe, expect, it } from "vitest";
import {
  bool,
  expectPositionals,
  intFlag,
  listValues,
  parseArgs,
  shellQuote,
  str,
} from "../src/args.js";

const spec = {
  bool: ["yes"],
  value: ["project", "limit"],
  repeat: ["tag"],
  renamed: { state: "use --status" },
};

describe("parseArgs", () => {
  it("parses positionals, values, booleans and repeats", () => {
    const p = parseArgs(
      ["Buy milk", "--project", "abc", "--tag", "a", "--tag=b", "--yes"],
      spec,
      "create",
    );
    expect(p.positionals).toEqual(["Buy milk"]);
    expect(str(p, "project")).toBe("abc");
    expect(bool(p, "yes")).toBe(true);
    expect(p.multi.tag).toEqual(["a", "b"]);
  });
  it("accepts --flag=value and values starting with a single dash", () => {
    const p = parseArgs(["--project=x", "--limit", "-1d"], spec, "t");
    expect(str(p, "project")).toBe("x");
    expect(str(p, "limit")).toBe("-1d");
  });
  it("treats everything after -- as positionals", () => {
    const p = parseArgs(["--", "--yes", "-x"], spec, "t");
    expect(p.positionals).toEqual(["--yes", "-x"]);
    expect(bool(p, "yes")).toBe(false);
  });
  it("keeps negative numbers and a bare dash as positionals", () => {
    expect(parseArgs(["-5", "-"], spec, "t").positionals).toEqual(["-5", "-"]);
  });
  it("rejects unknown flags with the valid list (exit 2)", () => {
    expect(() => parseArgs(["--stat", "x"], spec, "tasks")).toThrow(
      /unknown flag --stat for `tasks`/,
    );
    try {
      parseArgs(["--stat"], spec, "tasks");
    } catch (e: any) {
      expect(e.code).toBe("VALIDATION_ERROR");
      expect(e.suggestions[0]).toContain("--yes, --project, --limit, --tag");
    }
  });
  it("rejects short flags and gives targeted hints for renamed flags", () => {
    expect(() => parseArgs(["-y"], spec, "t")).toThrow(/unknown flag -y/);
    try {
      parseArgs(["--state=open"], spec, "t");
    } catch (e: any) {
      expect(e.suggestions).toEqual(["use --status"]);
    }
  });
  it("explains flagless commands", () => {
    try {
      parseArgs(["--x"], {}, "t");
    } catch (e: any) {
      expect(e.suggestions[0]).toContain("takes no flags");
    }
  });
  it("rejects missing values, duplicate values and values on booleans", () => {
    expect(() => parseArgs(["--project"], spec, "t")).toThrow(/needs a value/);
    expect(() => parseArgs(["--project", "--yes"], spec, "t")).toThrow(
      /needs a value/,
    );
    expect(() =>
      parseArgs(["--project", "a", "--project", "b"], spec, "t"),
    ).toThrow(/more than once/);
    expect(() => parseArgs(["--yes=true"], spec, "t")).toThrow(
      /does not take a value/,
    );
  });
});

describe("helpers", () => {
  it("intFlag bounds and validates", () => {
    const p = (v: string) => parseArgs(["--limit", v], spec, "t");
    expect(intFlag(parseArgs([], spec, "t"), "limit", 7, 1, 10)).toBe(7);
    expect(intFlag(p("5"), "limit", 7, 1, 10)).toBe(5);
    expect(() => intFlag(p("x"), "limit", 7, 1, 10)).toThrow(/whole number/);
    expect(() => intFlag(p("11"), "limit", 7, 1, 10)).toThrow(
      /between 1 and 10/,
    );
  });
  it("listValues splits commas and de-duplicates", () => {
    expect(listValues(["a, b", "b", undefined, "c,,"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
  it("expectPositionals reports missing and extra arguments", () => {
    const one = parseArgs(["a"], spec, "t");
    expect(expectPositionals(one, 1, "u")).toEqual(["a"]);
    expect(() => expectPositionals(one, 2, "u")).toThrow(/missing argument/);
    expect(() =>
      expectPositionals(parseArgs(["a", "b"], spec, "t"), 1, "u"),
    ).toThrow(/unexpected argument "b"/);
  });
  it("shellQuote leaves safe words alone and quotes the rest", () => {
    expect(shellQuote("abc-1.2")).toBe("abc-1.2");
    expect(shellQuote("Pay rent")).toBe("'Pay rent'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});
