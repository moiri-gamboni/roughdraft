import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reportsDirectory: "../../coverage/server",
      exclude: ["dist/**", "src/**/*.test.ts", "defaults.d.mts"],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
