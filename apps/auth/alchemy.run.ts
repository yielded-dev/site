import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import Auth from "./src/worker";

export default Alchemy.Stack(
  "yielded-auth",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    yield* Auth;

    return { url: "https://auth.yielded.dev" };
  }),
);
