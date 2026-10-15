import { OAuthServer } from "@yielded/auth";
import type { Jwk } from "@yielded/jose";
import { Clock, Context, Effect, Redacted, Schema, Semaphore } from "effect";
import { Base64Url } from "effect/encoding";

import { AppClaims, AppSession } from "../shared/access";
import { agentScopes, authScopes } from "../shared/scopes";

export const accessCookie = "__Host-yielded-access";
export const sessionCookie = "__Host-yielded-session";
const lifetime = 30 * 24 * 60 * 60 * 1000;

const Flow = Schema.Struct({
  state: Schema.String,
  verifier: Schema.String,
  returnTo: Schema.String,
  expiresAt: Schema.Int,
});

const Session = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  subjectId: Schema.String,
  expiresAt: Schema.Int,
  refreshedAt: Schema.Int,
});

const Record = Schema.Struct({
  flow: Schema.optionalKey(Flow),
  session: Schema.optionalKey(Session),
});

const Tokens = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  token_type: Schema.Literal("Bearer"),
});

export class GatewayUnavailable extends Schema.TaggedError<GatewayUnavailable>()(
  "GatewayUnavailable",
  {},
) {}

export class GatewayIssuer extends Context.Service<
  GatewayIssuer,
  { readonly request: (request: Request) => Effect.Effect<Response, GatewayUnavailable> }
>()("site/auth/GatewayIssuer") {}

class SignInRequired extends Schema.TaggedError<SignInRequired>()("SignInRequired", {}) {}
class SignInPending extends Schema.TaggedError<SignInPending>()("SignInPending", {}) {}

export interface GatewayStorage {
  readonly read: Effect.Effect<unknown, GatewayUnavailable>;
  readonly write: (
    value: typeof Record.Type,
    expiresAt: number,
  ) => Effect.Effect<void, GatewayUnavailable>;
}

export interface GatewayConfiguration {
  readonly issuer: string;
  readonly resource: string;
  readonly clientSecret: Redacted.Redacted<string>;
  readonly publicKeys: readonly Jwk.PublicJwk[];
}

export const random = () => Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)));

export const cookie = (name: string, value: string, age: number) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(age))}`;

export const sessionHandle = (request: Request) => {
  const found = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${sessionCookie}=`))
    ?.slice(sessionCookie.length + 1);

  return found !== undefined && /^[A-Za-z0-9_-]{43}$/.test(found) ? found : undefined;
};

/** One object per opaque browser session serializes token rotation across tabs.
 * Only this Site-owned server sees refresh tokens; API Workers receive short JWTs.
 */
export const makeGateway = (config: GatewayConfiguration, storage: GatewayStorage) =>
  Effect.gen(function* () {
    const issuer = yield* GatewayIssuer;

    const verifier = yield* OAuthServer.makeAccessTokenVerifier({
      issuer: config.issuer,
      resource: config.resource,
      publicKeys: config.publicKeys,
      scopes: authScopes,
    });

    const mutex = yield* Semaphore.make(1);
    const callback = `${config.resource}/auth/yielded/callback`;

    const read = storage.read.pipe(
      Effect.flatMap((value) =>
        value === undefined
          ? Effect.succeed(Record.make({}))
          : Schema.decodeUnknownEffect(Record)(value, { reportInput: false }),
      ),
      Effect.mapError(() => GatewayUnavailable.make({})),
    );

    const clear = storage.write({}, 0);

    const requestTokens = (fields: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        const body = new URLSearchParams({
          client_id: "yielded-agent",
          client_secret: Redacted.value(config.clientSecret),
          ...fields,
        });

        const response = yield* issuer.request(
          new Request(`${config.issuer}/oauth/yielded/token`, {
            method: "POST",
            body,
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          }),
        );

        if (response.status === 400 || response.status === 401)
          return yield* SignInRequired.make({});
        if (!response.ok) return yield* GatewayUnavailable.make({});

        const value = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () => GatewayUnavailable.make({}),
        });

        return yield* Schema.decodeUnknownEffect(Tokens)(value, { reportInput: false }).pipe(
          Effect.mapError(() => GatewayUnavailable.make({})),
        );
      });

    const describe = (token: string) =>
      Effect.gen(function* () {
        const decoded = yield* verifier.decode(Redacted.make(token));

        const claims = yield* Schema.decodeUnknownEffect(AppClaims)(decoded.access.claims, {
          reportInput: false,
        });

        if (decoded.access.clientId !== "yielded-agent") return yield* SignInRequired.make({});

        return AppSession.make({
          subjectId: decoded.access.subjectId,
          ...claims,
          scopes: decoded.access.scopes,
          expiresAtMillis: decoded.claims.exp * 1000,
        });
      });

    const response = (body: string | null, status = 200, headers?: HeadersInit) =>
      new Response(body, {
        status,
        headers: {
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "content-type": "application/json",
          ...headers,
        },
      });

    const signedOut = () => {
      const result = response("null");

      result.headers.append("set-cookie", cookie(accessCookie, "", 0));
      result.headers.append("set-cookie", cookie(sessionCookie, "", 0));

      return result;
    };

    const authenticated = (session: typeof Session.Type) =>
      Effect.gen(function* () {
        const principal = yield* describe(session.accessToken);
        const result = response(JSON.stringify(principal));

        result.headers.append(
          "set-cookie",
          cookie(
            accessCookie,
            session.accessToken,
            (principal.expiresAtMillis - (yield* Clock.currentTimeMillis)) / 1000,
          ),
        );

        return result;
      });

    const currentSession = (force: boolean) =>
      Effect.gen(function* () {
        const record = yield* read;
        const session = record.session;
        const now = yield* Clock.currentTimeMillis;

        if (session === undefined && record.flow !== undefined && record.flow.expiresAt > now)
          return yield* SignInPending.make({});
        if (session === undefined || session.expiresAt <= now)
          return yield* SignInRequired.make({});
        const principal = yield* describe(session.accessToken).pipe(Effect.option);

        if (
          principal._tag === "Some" &&
          principal.value.expiresAtMillis > now + 30_000 &&
          (!force || session.refreshedAt > now - 30_000)
        )
          return session;
        // A crash or ambiguous network result must never replay a rotating refresh token.
        yield* clear;

        const tokens = yield* requestTokens({
          grant_type: "refresh_token",
          refresh_token: session.refreshToken,
        });

        const refreshed = yield* describe(tokens.access_token);

        if (refreshed.subjectId !== session.subjectId) return yield* SignInRequired.make({});

        const next = {
          ...session,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          refreshedAt: now,
        };

        yield* storage.write({ session: next }, next.expiresAt);

        return next;
      });

    const handle = (request: Request) =>
      Effect.gen(function* () {
        const url = new URL(request.url);

        if (url.origin !== config.resource) return response(null, 404);
        if (request.method === "POST" && request.headers.get("origin") !== config.resource)
          return response(null, 403);
        if (request.method === "GET" && url.pathname === "/auth/login") {
          const candidate = url.searchParams.get("return") ?? "/";
          const target = new URL(candidate, config.resource);

          if (
            target.origin !== config.resource ||
            !(
              target.pathname === "/" ||
              target.pathname.startsWith("/travel/") ||
              target.pathname.startsWith("/browser-use")
            )
          )
            return response(null, 400);

          const flow = {
            state: random(),
            verifier: random(),
            returnTo: target.pathname + target.search,
            expiresAt: (yield* Clock.currentTimeMillis) + 300_000,
          };

          yield* storage.write({ flow }, flow.expiresAt);

          const challenge = yield* Effect.tryPromise({
            try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(flow.verifier)),
            catch: () => GatewayUnavailable.make({}),
          });

          const authorize = new URL(`${config.issuer}/oauth/yielded/authorize`);

          authorize.search = new URLSearchParams({
            response_type: "code",
            client_id: "yielded-agent",
            redirect_uri: callback,
            resource: config.resource,
            scope: agentScopes.join(" "),
            state: flow.state,
            code_challenge: Base64Url.encode(new Uint8Array(challenge)),
            code_challenge_method: "S256",
          }).toString();

          return response(null, 303, { location: authorize.href });
        }
        if (request.method === "GET" && url.pathname === "/auth/yielded/callback") {
          const { flow } = yield* read;
          const code = url.searchParams.get("code");

          if (
            flow === undefined ||
            flow.expiresAt <= (yield* Clock.currentTimeMillis) ||
            url.searchParams.getAll("state").length !== 1 ||
            url.searchParams.getAll("code").length !== 1 ||
            url.searchParams.getAll("iss").length > 1 ||
            url.searchParams.get("state") !== flow.state ||
            code === null ||
            url.searchParams.has("error") ||
            (url.searchParams.has("iss") && url.searchParams.get("iss") !== config.issuer)
          )
            return new Response(
              "This sign-in attempt is invalid or expired. Return to the app and sign in again.",
              {
                status: 400,
                headers: {
                  "cache-control": "no-store",
                  "content-type": "text/plain",
                  "referrer-policy": "no-referrer",
                },
              },
            );
          yield* clear;

          const tokens = yield* requestTokens({
            grant_type: "authorization_code",
            code,
            redirect_uri: callback,
            code_verifier: flow.verifier,
            resource: config.resource,
          });

          const principal = yield* describe(tokens.access_token);
          const now = yield* Clock.currentTimeMillis;

          const session = {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            subjectId: principal.subjectId,
            expiresAt: now + lifetime,
            refreshedAt: now,
          };

          yield* storage.write({ session }, session.expiresAt);
          const result = response(null, 303, { location: flow.returnTo });

          result.headers.append(
            "set-cookie",
            cookie(accessCookie, session.accessToken, (principal.expiresAtMillis - now) / 1000),
          );

          return result;
        }
        if (
          (request.method === "GET" && url.pathname === "/auth/session") ||
          (request.method === "POST" && url.pathname === "/auth/refresh")
        )
          return yield* authenticated(yield* currentSession(request.method === "POST"));
        if (request.method === "POST" && url.pathname === "/auth/logout") {
          const { session } = yield* read;

          yield* clear;
          if (session !== undefined) {
            const body = new URLSearchParams({
              client_id: "yielded-agent",
              client_secret: Redacted.value(config.clientSecret),
              token: session.refreshToken,
              token_type_hint: "refresh_token",
            });

            yield* issuer
              .request(
                new Request(`${config.issuer}/oauth/yielded/revoke`, {
                  method: "POST",
                  body,
                  redirect: "error",
                  signal: AbortSignal.timeout(10_000),
                }),
              )
              .pipe(Effect.ignore);
          }

          return signedOut();
        }

        return response(null, 404);
      }).pipe(
        Effect.catchTag("SignInPending", () => Effect.succeed(response("null"))),
        Effect.catchTag("SignInRequired", () =>
          Effect.gen(function* () {
            yield* clear;
            if (new URL(request.url).pathname === "/auth/yielded/callback")
              return new Response(
                "Sign-in expired or was cancelled. Return to the app and sign in again.",
                {
                  status: 400,
                  headers: {
                    "cache-control": "no-store",
                    "content-type": "text/plain",
                    "referrer-policy": "no-referrer",
                  },
                },
              );

            return signedOut();
          }),
        ),
        Effect.orElseSucceed(() =>
          response(JSON.stringify({ error: "Sign-in is temporarily unavailable." }), 503),
        ),
        (effect) => mutex.withPermit(effect),
      );

    // An older alarm can already be queued when a callback replaces a flow with
    // a session. Serialize cleanup with requests and check the current deadline.
    const expire = mutex.withPermit(
      Effect.gen(function* () {
        const record = yield* read;
        const deadline = record.session?.expiresAt ?? record.flow?.expiresAt ?? 0;

        if (deadline <= (yield* Clock.currentTimeMillis)) yield* clear;
        else yield* storage.write(record, deadline);
      }),
    );

    return { handle, expire };
  });
