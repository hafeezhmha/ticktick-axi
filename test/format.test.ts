import { describe, expect, it } from "vitest";
import {
  checklistSummary,
  parseFields,
  parsePriority,
  parseStatus,
  priorityName,
  statusName,
  taskRow,
  truncate,
} from "../src/format.js";
import { TZ } from "./support.js";

describe("priority", () => {
  it("maps names and documented numbers", () => {
    expect(parsePriority("high")).toBe(5);
    expect(parsePriority("Medium")).toBe(3);
    expect(parsePriority("1")).toBe(1);
    expect(parsePriority("0")).toBe(0);
    expect(priorityName(5)).toBe("high");
    expect(priorityName(undefined)).toBe("none");
    expect(priorityName(9)).toBe("9");
  });
  it("rejects undocumented values", () => {
    expect(() => parsePriority("2")).toThrow(/not a valid priority/);
    expect(() => parsePriority("urgent")).toThrow(
      expect.objectContaining({
        suggestions: [expect.stringMatching(/none, low, medium, high/)],
      }),
    );
  });
});

describe("status", () => {
  it("maps API codes", () => {
    expect(statusName(0)).toBe("open");
    expect(statusName(2)).toBe("completed");
    expect(statusName(-1)).toBe("abandoned");
    expect(parseStatus("all").codes).toEqual([0, 2, -1]);
    expect(() => parseStatus("done")).toThrow(
      expect.objectContaining({
        suggestions: ["Use one of: open, completed, abandoned, all"],
      }),
    );
  });
});

describe("truncate", () => {
  it("keeps short text and reports totals for long text", () => {
    expect(truncate("abc", 5)).toEqual({
      text: "abc",
      truncated: false,
      total: 3,
    });
    expect(truncate("abcdefgh", 3)).toEqual({
      text: "abc...",
      truncated: true,
      total: 8,
    });
  });
});

describe("fields and rows", () => {
  it("validates --fields", () => {
    expect(parseFields(undefined)).toEqual([]);
    expect(parseFields("priority, tags")).toEqual(["priority", "tags"]);
    expect(() => parseFields("priority,bogus")).toThrow(
      /unknown field "bogus"/,
    );
  });
  it("builds rows with base and extra columns", () => {
    const task = {
      id: "t1",
      projectId: "p1",
      title: "x".repeat(150),
      dueDate: "2026-10-09T10:30:00+0000",
      startDate: "2026-10-09T09:30:00+0000",
      completedTime: "2026-10-09T11:00:00+0000",
      priority: 3,
      status: 0,
      tags: ["a", "b"],
      repeatFlag: "RRULE:FREQ=DAILY;INTERVAL=1",
      kind: "CHECKLIST",
      content: "notes",
      items: [{ status: 1 }, { status: 0 }],
    };
    const row = taskRow(task, {
      tz: TZ,
      base: ["id", "title", "due"],
      extra: [
        "projectId",
        "priority",
        "status",
        "tags",
        "start",
        "allDay",
        "repeat",
        "completed",
        "kind",
        "items",
        "content",
        "id",
      ],
      full: false,
    });
    expect(row).toEqual({
      id: "t1",
      title: `${"x".repeat(100)}...`,
      due: "2026-10-09 16:00",
      projectId: "p1",
      priority: "medium",
      status: "open",
      tags: "a b",
      start: "2026-10-09 15:00",
      allDay: false,
      repeat: "FREQ=DAILY;INTERVAL=1",
      completed: "2026-10-09 16:30",
      kind: "CHECKLIST",
      items: "1/2 done",
      content: "notes",
    });
    const fullRow = taskRow(
      {
        id: "t2",
        projectId: "p",
        content: "y".repeat(150),
        title: "z".repeat(150),
      },
      {
        tz: TZ,
        base: ["title", "due"],
        extra: [
          "content",
          "items",
          "start",
          "completed",
          "repeat",
          "kind",
          "tags",
        ],
        full: true,
      },
    );
    expect(fullRow.title).toHaveLength(150);
    expect(fullRow.content).toHaveLength(150);
    expect(fullRow.due).toBe("");
    expect(fullRow.items).toBe("");
  });
  it("summarises checklists", () => {
    expect(checklistSummary({ id: "a", projectId: "b" })).toBeUndefined();
  });
});
