import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test runs offline: API calls go through a stubbed `fetch`, and the
    // config dir is a per-test temp dir, never the real ~/.config.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
