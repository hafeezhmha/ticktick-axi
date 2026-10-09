import { describe, expect, it } from "vitest";
import {
  addDays,
  compareToBound,
  dateKey,
  daysBetween,
  displayDate,
  dueInfo,
  formatApiDate,
  isOverdue,
  isValidTimeZone,
  parseApiDate,
  parseUserDate,
  userTimeZone,
  zonedToUtc,
} from "../src/dates.js";
import { NOW, TZ } from "./support.js";

describe("parseApiDate", () => {
  it("parses TickTick's +0000 format with and without millis", () => {
    expect(parseApiDate("2019-11-13T03:00:00+0000")?.toISOString()).toBe(
      "2019-11-13T03:00:00.000Z",
    );
    expect(parseApiDate("2026-03-05T00:00:00.000+0000")?.toISOString()).toBe(
      "2026-03-05T00:00:00.000Z",
    );
    expect(parseApiDate("2026-03-05T05:30:00+0530")?.toISOString()).toBe(
      "2026-03-05T00:00:00.000Z",
    );
  });
  it("returns null for missing or garbage values", () => {
    expect(parseApiDate(undefined)).toBeNull();
    expect(parseApiDate("")).toBeNull();
    expect(parseApiDate("not a date")).toBeNull();
  });
});

describe("formatApiDate", () => {
  it("emits yyyy-MM-dd'T'HH:mm:ss+0000", () => {
    expect(formatApiDate(Date.parse("2026-10-09T18:30:00Z"))).toBe(
      "2026-10-09T18:30:00+0000",
    );
  });
});

describe("zones", () => {
  it("computes local midnight in UTC", () => {
    expect(new Date(zonedToUtc(2026, 10, 10, 0, 0, TZ)).toISOString()).toBe(
      "2026-10-09T18:30:00.000Z",
    );
  });
  it("handles DST transitions", () => {
    // New York springs forward on 2026-03-08; 09:00 is EDT (UTC-4).
    expect(
      new Date(zonedToUtc(2026, 3, 8, 9, 0, "America/New_York")).toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");
    expect(
      new Date(zonedToUtc(2026, 3, 7, 9, 0, "America/New_York")).toISOString(),
    ).toBe("2026-03-07T14:00:00.000Z");
  });
  it("gives the calendar date in a zone", () => {
    const t = Date.parse("2026-10-09T20:00:00Z");
    expect(dateKey(t, TZ)).toBe("2026-10-10");
    expect(dateKey(t, "America/Los_Angeles")).toBe("2026-10-09");
  });
  it("validates zone names", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
  });
  it("reads TICKTICK_AXI_TZ and rejects invalid zones", () => {
    expect(userTimeZone({ TICKTICK_AXI_TZ: "Europe/London" })).toBe(
      "Europe/London",
    );
    expect(() => userTimeZone({ TICKTICK_AXI_TZ: "Nope/Zone" })).toThrow(
      /not a valid IANA time zone/,
    );
    expect(userTimeZone({})).toBeTruthy();
  });
});

describe("calendar arithmetic", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("counts days between dates", () => {
    expect(daysBetween("2026-10-09", "2026-10-12")).toBe(3);
    expect(daysBetween("2026-10-09", "2026-10-01")).toBe(-8);
  });
});

describe("parseUserDate", () => {
  const p = (s: string) => parseUserDate(s, "--due", TZ, NOW);
  it("understands relative words and offsets", () => {
    expect(p("today")).toEqual({ kind: "date", key: "2026-10-09" });
    expect(p("Tomorrow")).toEqual({ kind: "date", key: "2026-10-10" });
    expect(p("yesterday")).toEqual({ kind: "date", key: "2026-10-08" });
    expect(p("+3d")).toEqual({ kind: "date", key: "2026-10-12" });
    expect(p("-2d")).toEqual({ kind: "date", key: "2026-10-07" });
  });
  it("accepts ISO dates and validates the calendar", () => {
    expect(p("2026-11-01")).toEqual({ kind: "date", key: "2026-11-01" });
    expect(() => p("2026-02-30")).toThrow(/not a valid date/);
    expect(() => p("2026-13-01")).toThrow(/not a valid date/);
  });
  it("reads date-times without offset in the user's zone", () => {
    expect(p("2026-10-12T10:30")).toEqual({
      kind: "datetime",
      instant: Date.parse("2026-10-12T05:00:00Z"),
    });
    expect(p("2026-10-12 10:30:15")).toEqual({
      kind: "datetime",
      instant: Date.parse("2026-10-12T05:00:15Z"),
    });
  });
  it("honours explicit Z and offsets", () => {
    expect(p("2026-10-12T10:30:00Z")).toEqual({
      kind: "datetime",
      instant: Date.parse("2026-10-12T10:30:00Z"),
    });
    expect(p("2026-10-12T10:30:00+0200")).toEqual({
      kind: "datetime",
      instant: Date.parse("2026-10-12T08:30:00Z"),
    });
    expect(p("2026-10-12T10:30:00.123-05:00")).toEqual({
      kind: "datetime",
      instant: Date.parse("2026-10-12T15:30:00Z"),
    });
  });
  it("rejects garbage and impossible times", () => {
    for (const bad of [
      "next week",
      "10/12/2026",
      "2026-10-12T25:00",
      "+d",
      "",
    ]) {
      expect(() => p(bad)).toThrow(/not a valid date/);
    }
  });
});

describe("dueInfo / isOverdue", () => {
  it("reads all-day dates in the task's own zone", () => {
    const info = dueInfo(
      {
        dueDate: "2026-10-10T07:00:00+0000", // midnight Oct 10 in Los Angeles
        isAllDay: true,
        timeZone: "America/Los_Angeles",
      },
      TZ,
    );
    expect(info).toMatchObject({
      key: "2026-10-10",
      display: "2026-10-10",
      allDay: true,
    });
  });
  it("falls back to the user zone for unknown task zones", () => {
    const info = dueInfo(
      {
        dueDate: "2026-10-09T18:30:00+0000",
        isAllDay: true,
        timeZone: "Bad/Zone",
      },
      TZ,
    );
    expect(info?.key).toBe("2026-10-10");
  });
  it("shows timed tasks in the user zone", () => {
    const info = dueInfo({ dueDate: "2026-10-09T10:30:00+0000" }, TZ);
    expect(info?.display).toBe("2026-10-09 16:00");
  });
  it("returns null without a due date", () => {
    expect(dueInfo({}, TZ)).toBeNull();
  });
  it("treats all-day tasks as overdue only after their day", () => {
    const today = dueInfo(
      { dueDate: "2026-10-08T18:30:00+0000", isAllDay: true, timeZone: TZ },
      TZ,
    )!;
    const yesterday = dueInfo(
      { dueDate: "2026-10-07T18:30:00+0000", isAllDay: true, timeZone: TZ },
      TZ,
    )!;
    expect(isOverdue(today, TZ, NOW)).toBe(false);
    expect(isOverdue(yesterday, TZ, NOW)).toBe(true);
  });
  it("treats timed tasks as overdue once their time passes", () => {
    const earlier = dueInfo({ dueDate: "2026-10-09T03:30:00+0000" }, TZ)!;
    const later = dueInfo({ dueDate: "2026-10-09T10:30:00+0000" }, TZ)!;
    expect(isOverdue(earlier, TZ, NOW)).toBe(true);
    expect(isOverdue(later, TZ, NOW)).toBe(false);
  });
  it("compares against date and date-time bounds", () => {
    const info = dueInfo({ dueDate: "2026-10-09T10:30:00+0000" }, TZ)!;
    expect(compareToBound(info, { kind: "date", key: "2026-10-10" })).toBe(-1);
    expect(compareToBound(info, { kind: "date", key: "2026-10-09" })).toBe(0);
    expect(compareToBound(info, { kind: "date", key: "2026-10-01" })).toBe(1);
    expect(
      compareToBound(info, {
        kind: "datetime",
        instant: Date.parse("2026-10-09T11:00:00Z"),
      }),
    ).toBe(-1);
  });
  it("renders other date fields", () => {
    expect(displayDate(undefined, false, TZ)).toBeUndefined();
    expect(displayDate("2026-10-09T10:30:00+0000", false, TZ)).toBe(
      "2026-10-09 16:00",
    );
  });
});
