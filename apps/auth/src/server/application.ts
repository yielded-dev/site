import { Hooks, Http, OAuth, OAuthServer } from "@yielded/auth";
import { Effect, Layer, type Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { SqlClient } from "effect/sql";

import { AgentScope } from "../shared/scopes";
import { AccessPolicy, accessRoutes, authorizationLayer, type LegacyDirectory } from "./access";
import { SettingsActionsLive, SettingsAuth } from "./auth";
import { consentLayer } from "./consent";
import { CryptoLive } from "./crypto";
import { identityLayer, yielded, YieldedGrantsLive } from "./identity";
import type { IdentityKeyMaterial } from "./identity-keys";
import { providerLayer } from "./provider";
import { settingsStorage } from "./storage";

export interface SettingsConfiguration {
  readonly origin: URL;
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  readonly externalSubject: string;
  readonly displayName: string;
  readonly stylesheet: string;
  readonly legacy?: LegacyDirectory;
  readonly agent: {
    readonly origin: URL;
    readonly secret: Redacted.Redacted<string>;
    readonly keys: typeof IdentityKeyMaterial.Type;
  };
}

/** The host supplies the SQL owner and stable keys; all auth policy is shared. */
export const settingsApplication = (config: SettingsConfiguration) => {
  const secure = config.origin.protocol === "https:";
  const prefix = `${secure ? "__Host-" : ""}oauth-settings-`;

  const http = Http.make(SettingsAuth, {
    origin: config.origin.origin,
    cookie: { prefix, secure },
  });

  const infrastructure = Layer.mergeAll(
    Hooks.LifecycleHooks.empty,
    providerLayer(config),
    OAuth.OAuthReturnTargets.exactRoutes(["/oauth-settings", yielded.paths.authorize]),
    Layer.effect(
      SettingsAuth.strategies.oauth.SessionClaims,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        return SettingsAuth.strategies.oauth.SessionClaims.of({
          resolve: Effect.fn("Yielded.resolveClaims")(function* ({ subjectId, identity }) {
            const displayName =
              subjectId === "settings-owner"
                ? config.displayName
                : identity.profile?.displayName || identity.profile?.handle || "Yielded member";

            yield* sql`INSERT INTO oauth_account_profile ("subjectId", "displayName")
              VALUES (${subjectId}, ${displayName})
              ON CONFLICT ("subjectId") DO UPDATE SET "displayName" = excluded."displayName"`.pipe(
              Effect.mapError(() => OAuth.OAuthUnavailable.make({})),
            );

            return { displayName };
          }),
        });
      }),
    ),
  ).pipe(Layer.provideMerge(CryptoLive), Layer.provideMerge(FetchHttpClient.layer));

  const storage = settingsStorage(config.externalSubject).pipe(Layer.provideMerge(infrastructure));

  const live = SettingsAuth.layer.pipe(
    Layer.provide(SettingsActionsLive.pipe(Layer.provideMerge(storage))),
  );

  const access = AccessPolicy.layer(config.origin.origin, config.legacy).pipe(
    Layer.provide(storage),
  );

  const agent = config.agent;

  const sharedSignIn = yielded.routes.pipe(
    Layer.provide(
      yielded
        .layer({
          origin: config.origin.origin,
          resource: agent.origin.origin,
          accessTokenFormat: "jwt",
          accessTokenLifetimeMillis: 300_000,
          refreshTokens: true,
          loginPath: "/sign-in",
          keys: { activeKeyId: "v1", keys: [{ id: "v1", material: agent.keys.consent }] },
          identityKeys: {
            activeKeyId: "v1",
            privateKey: agent.keys.privateKey,
            publicKeys: [agent.keys.publicKey],
          },
          clients: [
            {
              clientId: "yielded-agent",
              name: "Yielded Agent",
              redirectUris: [`${agent.origin.origin}/auth/yielded/callback`],
              clientSecret: agent.secret,
              grantTypes: ["authorization_code", "refresh_token"],
            },
          ],
        })
        .pipe(
          Layer.provide(identityLayer(`${prefix}session`, config.displayName)),
          Layer.provide(authorizationLayer(agent.origin.origin).pipe(Layer.provide(access))),
          Layer.provide(YieldedGrantsLive),
          Layer.provide(consentLayer(config.stylesheet, config.displayName)),
          Layer.provide(
            Layer.succeed(OAuthServer.OpenIdConsent, {
              approved: ({ clientId, redirectUri, scopes }) =>
                Effect.succeed(
                  clientId === "yielded-agent" &&
                    redirectUri === `${agent.origin.origin}/auth/yielded/callback` &&
                    scopes.every(Schema.is(AgentScope)),
                ),
            }),
          ),
          Layer.provide(live),
          Layer.provide(storage),
        ),
    ),
  );

  return Layer.mergeAll(
    http.routes().pipe(Layer.provide(live)),
    sharedSignIn,
    accessRoutes(config.origin.origin, `${prefix}session`, agent.secret).pipe(
      Layer.provide(live),
      Layer.provide(access),
    ),
  ).pipe(Layer.provide(infrastructure));
};
