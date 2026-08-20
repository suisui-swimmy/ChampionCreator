import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/firestore.rules.test.ts"],
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
