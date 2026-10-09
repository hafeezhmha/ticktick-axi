import { afterEach, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  process.exitCode = undefined;
});
