import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        app: "index.html",
        guide: "guide/index.html",
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
