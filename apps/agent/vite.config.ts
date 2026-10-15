import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      "prepare:source": { command: "bun host.mjs prepare", cache: false },
      plan: { command: "bun host.mjs plan", cache: false },
      deploy: { command: "bun host.mjs deploy", cache: false },
    },
  },
});
