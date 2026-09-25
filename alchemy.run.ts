import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

export default Alchemy.Stack(
  "yielded-site",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // Library docs deploy from their own repositories on more specific routes
    // (yielded.dev/sync*, yielded.dev/auth*), which take precedence over this one.
    yield* Cloudflare.Website.StaticSite("Landing", {
      name: "yielded-landing",
      command: "vp run @yielded/landing#build",
      outdir: "apps/landing/dist",
      routes: [{ pattern: "yielded.dev/*", zoneName: "yielded.dev" }],
      workersDev: false,
      dev: { command: "vp run @yielded/landing#dev" },
      assets: { notFoundHandling: "404-page" },
      memo: { include: ["apps/landing/**", "packages/starlight-theme/**"], lockfile: true },
    });

    return { url: "https://yielded.dev/" };
  }),
);
