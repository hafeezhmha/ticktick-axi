import { beforeEach, describe, expect, it } from "vitest";
import { isolate, json, mockFetch, PROJECT, run } from "./support.js";

const T1 = "a00000000000000000000001";
const notFound = (url: RegExp) => ({
  url,
  res: json({ errorMessage: "not found" }, 404),
});

beforeEach(() => {
  isolate();
});

/** AXI: repeating a delete is an idempotent no-op (exit 0), never an error. */
describe("deleting something already gone", () => {
  it.each([
    ["task", ["delete", PROJECT, T1], [notFound(/\/task\//)]],
    ["project", ["project", "delete", PROJECT], [notFound(/\/project\//)]],
    [
      "project group",
      ["group", "delete", "g9"],
      [{ url: /\/project\/group$/, res: json([]) }],
    ],
    ["focus record", ["focus", "delete", "f9"], [notFound(/\/focus\//)]],
  ] as const)(
    "%s: exit 0, says so, sends no delete",
    async (what, argv, routes) => {
      const calls = mockFetch([...routes]);
      for (const extra of [[], ["--yes"]]) {
        const { out, code } = await run(...argv, ...extra);
        expect(code, out).toBe(0);
        expect(out).toContain(`${what} `);
        expect(out).toContain("already deleted, or the id is wrong (no-op)");
      }
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    },
  );
});
