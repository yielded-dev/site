import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

export default Alchemy.Stack(
  "yielded-site",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // Library docs deploy from their own repositories on more specific routes
    // (yielded.dev/sync*, yielded.dev/auth*), which take precedence over this one.
    // `/404` is the built `404.html`, so the asset layer would serve that URL
    // with 200. The worker returns the same document with status 404. Only
    // those paths run ahead of the assets; unknown paths still use
    // `notFoundHandling`.
    yield* Cloudflare.Website.StaticSite("Landing", {
      name: "yielded-landing",
      command: "vp run @yielded/landing#build",
      outdir: "apps/landing/dist",
      main: "./apps/landing/worker.ts",
      routes: [{ pattern: "yielded.dev/*", zoneName: "yielded.dev" }],
      workersDev: false,
      dev: { command: "vp run @yielded/landing#dev" },
      assets: {
        notFoundHandling: "404-page",
        runWorkerFirst: ["/404", "/404/", "/404.html"],
      },
      memo: { include: ["apps/landing/**", "packages/starlight-theme/**"], lockfile: true },
    });

    return { url: "https://yielded.dev/" };
  }),
);
