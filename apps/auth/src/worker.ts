import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Layer, Schema } from "effect";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerResponse,
} from "effect/http";

import { settingsApplication } from "./application";
import { CryptoLive } from "./crypto";
import { IdentityKeyMaterial } from "./identity-keys";
import { SettingsKeyMaterial, settingsKeysLayer } from "./keys";

const Origin = Schema.String.check(
  Schema.makeFilter((value) => {
    try {
      const url = new URL(value);

      return url.protocol === "https:" && url.origin === value;
    } catch {
      return false;
    }
  }),
);

const Configuration = Schema.Struct({
  AUTH_ORIGIN: Origin,
  GITHUB_CLIENT_ID: Schema.NonEmptyString,
  GITHUB_CLIENT_SECRET: Schema.RedactedFromValue(Schema.NonEmptyString),
  GITHUB_USER_ID: Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/)),
  YIELDED_DISPLAY_NAME: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  YIELDED_AGENT_ORIGIN: Origin,
  YIELDED_AGENT_CLIENT_SECRET: Schema.RedactedFromValue(Schema.NonEmptyString),
  AUTH_SETTINGS_KEYS: SettingsKeyMaterial,
  AUTH_IDENTITY_KEYS: IdentityKeyMaterial,
});

class HostedAuthUnavailable extends Schema.TaggedError<HostedAuthUnavailable>()(
  "HostedAuthUnavailable",
  {},
) {}

const unavailable = HttpServerResponse.text(
  "Sign-in is temporarily unavailable. Start a new attempt later.",
  { status: 503, headers: { "cache-control": "no-store" } },
);

/** The request scope owns the SQL layer and its one transaction owner. */
const hostedAuth = Effect.map(Cloudflare.WorkerEnvironment, (env) =>
  Effect.map(Cloudflare.DurableObjectState, (state) =>
    Effect.succeed({
      fetch: Effect.gen(function* () {
        const assets: Fetcher = env.ASSETS;

        const config = yield* Schema.decodeUnknownEffect(Configuration)(env, {
          reportInput: false,
        });

        const response = yield* Effect.tryPromise({
          try: () => assets.fetch(`${config.AUTH_ORIGIN}/oauth-settings.html`),
          catch: () => HostedAuthUnavailable.make({}),
        });

        if (response.status !== 200) return yield* HostedAuthUnavailable.make({});

        const html = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => HostedAuthUnavailable.make({}),
        });

        const stylesheet = html.match(
          /<link rel="stylesheet"[^>]*href="(\/assets\/[^"<>]+\.css)"/,
        )?.[1];

        if (stylesheet === undefined) return yield* HostedAuthUnavailable.make({});

        return yield* HttpRouter.toHttpEffect(
          settingsApplication({
            origin: new URL(config.AUTH_ORIGIN),
            clientId: config.GITHUB_CLIENT_ID,
            clientSecret: config.GITHUB_CLIENT_SECRET,
            externalSubject: config.GITHUB_USER_ID,
            displayName: config.YIELDED_DISPLAY_NAME,
            stylesheet,
            agent: {
              origin: new URL(config.YIELDED_AGENT_ORIGIN),
              secret: config.YIELDED_AGENT_CLIENT_SECRET,
              keys: config.AUTH_IDENTITY_KEYS,
            },
          }).pipe(
            Layer.provide(settingsKeysLayer(config.AUTH_SETTINGS_KEYS)),
            Layer.provide(SqliteClient.layer({ storage: state.raw.storage })),
            Layer.provide(CryptoLive),
            Layer.provide(HttpServer.layerServices),
            Layer.provide(Layer.succeed(HttpMiddleware.TracerDisabledWhen, () => true)),
          ),
        );
      }).pipe(
        Effect.orElseSucceed(() => Effect.succeed(unavailable)),
        Effect.flatten,
        Effect.mapError((reason) =>
          HttpServerError.isHttpServerError(reason)
            ? reason
            : new HttpServerError.HttpServerError({ reason }),
        ),
      ),
    }),
  ),
);

export default class Auth extends Cloudflare.Worker<Auth>()(
  "Auth",
  {
    name: "yielded-auth",
    main: import.meta.url,
    compatibility: { date: "2026-07-01", flags: ["nodejs_compat"] },
    domain: { name: "auth.yielded.dev", zoneName: "yielded.dev" },
    workersDev: { enabled: false, previewsEnabled: false },
    assets: { directory: "./dist", runWorkerFirst: true },
    env: {
      AUTH: Cloudflare.DurableObject("AuthV1", { className: "HostedAuth" }),
      AUTH_ORIGIN: "https://auth.yielded.dev",
      GITHUB_CLIENT_ID: Config.NonEmptyString("GITHUB_CLIENT_ID"),
      GITHUB_CLIENT_SECRET: Config.Redacted("GITHUB_CLIENT_SECRET"),
      GITHUB_USER_ID: Config.NonEmptyString("GITHUB_USER_ID"),
      YIELDED_DISPLAY_NAME: Config.NonEmptyString("YIELDED_DISPLAY_NAME"),
      YIELDED_AGENT_ORIGIN: "https://agent.yielded.dev",
      YIELDED_AGENT_CLIENT_SECRET: Config.Redacted("YIELDED_AGENT_CLIENT_SECRET"),
      AUTH_SETTINGS_KEYS: Config.Redacted("AUTH_SETTINGS_KEYS"),
      AUTH_IDENTITY_KEYS: Config.Redacted("AUTH_IDENTITY_KEYS"),
    },
    observability: {
      enabled: false,
      logs: { enabled: false, invocationLogs: false },
      traces: { enabled: false },
    },
    logpush: false,
  },
  Effect.gen(function* () {
    // Keep the deployed AUTH binding and HostedAuth class paired. The class-form
    // DurableObject constructor would allocate a binding named HostedAuth instead.
    yield* (yield* Cloudflare.Worker).export("HostedAuth", {
      kind: "durableObject",
      constructor: yield* hostedAuth,
      services: yield* Effect.context(),
    } satisfies Cloudflare.DurableObjectExport);

    return {
      fetch: Effect.gen(function* () {
        const request = yield* Cloudflare.Request;
        const env = yield* Cloudflare.WorkerEnvironment;
        const assets: Fetcher = env.ASSETS;
        const auth: DurableObjectNamespace = env.AUTH;
        const origin = yield* Schema.decodeEffect(Origin)(env.AUTH_ORIGIN, { reportInput: false });
        const url = new URL(request.url);

        if (url.origin !== origin) return HttpServerResponse.text("Not found", { status: 404 });
        if (url.pathname === "/")
          return HttpServerResponse.redirect(`${origin}/oauth-settings`, { status: 303 });
        if (["/oauth-settings", "/oauth-settings/callback", "/sign-in"].includes(url.pathname)) {
          if (request.method !== "GET") return HttpServerResponse.empty({ status: 405 });

          // Static asset lookups never carry provider callback parameters.
          const page = yield* Effect.tryPromise({
            try: () => assets.fetch(`${origin}/oauth-settings.html`),
            catch: () => HostedAuthUnavailable.make({}),
          });

          return HttpServerResponse.fromWeb(page).pipe(
            HttpServerResponse.setHeaders({
              "cache-control": "no-store",
              "referrer-policy": "no-referrer",
            }),
          );
        }

        const response = yield* Effect.tryPromise({
          try: () =>
            url.pathname.startsWith("/assets/") || url.pathname.startsWith("/brand/")
              ? assets.fetch(request)
              : auth.getByName("yielded-auth-v1").fetch(request),
          catch: () => HostedAuthUnavailable.make({}),
        });

        return HttpServerResponse.fromWeb(response);
      }).pipe(Effect.orElseSucceed(() => unavailable)),
    };
  }),
) {}
