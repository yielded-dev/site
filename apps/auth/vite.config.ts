import { defineConfig } from "vite-plus";

export default defineConfig({
  build: { rolldownOptions: { input: "oauth-settings.html" } },
  run: {
    tasks: {
      start: { command: "vp build && bun src/server/local.ts", cache: false },
      plan: {
        command: "vp build && vp exec alchemy plan alchemy.run.ts --stage production",
        cache: false,
      },
      deploy: {
        command: "vp build && vp exec alchemy deploy alchemy.run.ts --stage production",
        cache: false,
      },
    },
  },
});
