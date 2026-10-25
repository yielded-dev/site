import { Atom as AuthAtom, Client, OAuth, Operations } from "@yielded/auth";
import * as WebCrypto from "@yielded/crypto/WebCrypto";
import { Crypto, Effect, Layer, Redacted, Schema } from "effect";
import { KeyValueStore } from "effect/persistence";
import { Atom } from "effect/reactivity";

import { AccessRejected, AccessSettings, type GrantChange } from "../shared/access";
import { SettingsApi } from "../shared/contract";

// Only public attempt metadata survives a redirect; no code, state, or bearer.
const Attempt = Schema.Struct({
  kind: Schema.Literals(["sign-in", "link"]),
  callbackId: Schema.Literals(["github", "github-select"]),
  flowId: Operations.RequestBindingFlowId,
  expiresAtMillis: Schema.Int,
});

export class CallbackExpired extends Schema.TaggedError<CallbackExpired>()("CallbackExpired", {}) {}

const factory = Atom.context();

const runtime = factory(
  Layer.merge(
    KeyValueStore.layerStorage(() => sessionStorage),
    WebCrypto.layerCryptoWeb,
  ),
);

const randomUUID = Effect.flatMap(Crypto.Crypto, (crypto) => crypto.randomUUIDv4()).pipe(
  Effect.orDie,
);

const SettingsClient = Client.make(SettingsApi, { baseUrl: location.origin });

export const auth = AuthAtom.make(SettingsClient, { runtime: factory });
export const notice = Atom.make<string | null>(null);
export const cursor = Atom.make<string | undefined>(undefined);
export const sharedSignIn = Atom.make(location.pathname === "/sign-in");
const authorizationPath = "/oauth/yielded/authorize";

// Navigation starts before the browser unloads this document. Keep the transition
// visible through that interval, independently of request completion.
export const redirecting = Atom.make(false);

const accessRequest = Effect.fn("SiteAccess.request")(function* (change?: typeof GrantChange.Type) {
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(
        "/api/access",
        change === undefined
          ? { credentials: "same-origin" }
          : {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(change),
            },
      ),
    catch: () => AccessRejected.make({ reason: "unavailable" }),
  });

  const value = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () => AccessRejected.make({ reason: "unavailable" }),
  });

  if (!response.ok) {
    const error = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ reason: AccessRejected.fields.reason }),
    )(value);

    return yield* AccessRejected.make(error);
  }

  return yield* Schema.decodeUnknownEffect(AccessSettings)(value);
});

export const accessSettings = runtime.atom(accessRequest());

export const changeAccess = runtime.fn<typeof GrantChange.Type>()(
  Effect.fn("SiteAccess.change")(function* (change, get) {
    yield* accessRequest(change);
    get.refresh(accessSettings);
  }),
);

export const continueSignIn = Atom.fnSync((_: void, get) => {
  location.assign(authorizationPath);
  get.set(redirecting, true);
});

export const linkedAccounts = Atom.make((get) => {
  const page = get(cursor);

  return get(
    auth.listLinkedAccounts({ limit: 10, ...(page === undefined ? {} : { cursor: page }) }),
  );
});

const attempt = Atom.kvs({
  runtime,
  key: "oauth-settings/attempt",
  schema: Schema.NullOr(Attempt),
  defaultValue: () => null,
});

export const begin = runtime.fn<"sign-in" | "link" | "switch">()(
  Effect.fn("OAuthSettings.begin")(function* (kind, get) {
    get.set(notice, null);

    const input = {
      provider: "github",
      callbackId: kind === "sign-in" ? ("github" as const) : ("github-select" as const),
      returnTarget: kind !== "link" && get(sharedSignIn) ? authorizationPath : "/oauth-settings",
    };

    const started =
      kind === "link"
        ? yield* get.setResult(auth.linkAccount, { ...input, flowId: yield* randomUUID })
        : yield* get.setResult(auth.signIn, input);

    get.set(attempt, {
      kind: kind === "link" ? "link" : "sign-in",
      callbackId: input.callbackId,
      flowId: started.flowId,
      expiresAtMillis: started.expiresAtMillis,
    });
    yield* Effect.sync(() => location.assign(Redacted.value(started.authorizationUrl)));
    get.set(redirecting, true);
  }),
);

const CallbackQuery = Schema.Struct({
  state: Schema.String,
  code: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.String),
  iss: Schema.optionalKey(Schema.String),
});

export const complete = runtime.fn<void>()(
  Effect.fn("OAuthSettings.complete")(function* (_, get) {
    const url = new URL(location.href);

    if (url.pathname !== "/oauth-settings/callback") return;
    // Read once, then remove callback credentials from history before any request.
    const raw = Object.fromEntries(url.searchParams);

    yield* Effect.sync(() => history.replaceState(null, "", "/oauth-settings"));
    const saved = get(attempt);

    get.set(attempt, null);
    // The server owns expiry. A skewed browser clock must not reject a valid flow.
    if (saved === null) return yield* CallbackExpired.make({});
    const query = yield* Schema.decodeUnknownEffect(CallbackQuery)(raw);

    if ((query.code === undefined) === (query.error === undefined))
      return yield* CallbackExpired.make({});

    const response = yield* Schema.decodeEffect(OAuth.OAuthCallbackResponse)(
      query.code !== undefined
        ? {
            _tag: "Code",
            state: query.state,
            code: query.code,
            ...(query.iss === undefined ? {} : { issuer: query.iss }),
            ...(query.scope === undefined ? {} : { scope: query.scope }),
          }
        : {
            _tag: "Error",
            state: query.state,
            ...(query.iss === undefined ? {} : { issuer: query.iss }),
            error: query.error === "access_denied" ? "access-denied" : "rejected",
          },
    );

    const input = {
      flowId: saved.flowId,
      provider: "github",
      callbackId: saved.callbackId,
      response: yield* Schema.encodeEffect(OAuth.OAuthCallbackResponse)(response),
    };

    if (saved.kind === "link") {
      const result = yield* get.setResult(auth.completeAccountLink, input);

      get.set(cursor, undefined);
      get.set(
        notice,
        result._tag === "Cancelled"
          ? "Link cancelled. Your sign-in methods are unchanged. Choose Link another account to try again."
          : result.changed
            ? "Account linked. You can now sign in with either identity."
            : "This identity is already linked to your account.",
      );
    } else {
      const result = yield* get.setResult(auth.completeSignIn, input);

      const completion =
        "completion" in result
          ? result.completion
          : result._tag === "RegistrationRequired"
            ? yield* get.setResult(auth.register, {
                flowId: saved.flowId,
                reference: result.reference,
                commandId: yield* randomUUID,
                registration: {},
              })
            : undefined;

      if ("returnTarget" in result && result.returnTarget === authorizationPath) {
        get.set(sharedSignIn, true);
        if (completion?._tag === "Authenticated") {
          yield* Effect.sync(() => location.replace(authorizationPath));
          get.set(redirecting, true);

          return;
        }
        yield* Effect.sync(() => history.replaceState(null, "", "/sign-in"));
      }

      get.set(
        notice,
        "_tag" in result && result._tag === "Cancelled"
          ? "Sign-in cancelled. You can continue with this account or start again with GitHub."
          : completion?._tag === "RegistrationAccepted"
            ? "Your account was created. Continue with GitHub to sign in."
            : "Signed in. Account changes are available for five minutes.",
      );
    }
  }),
);

/** Only the authorization server's sign-in handoff auto-starts the provider.
 * Callback cancellation/errors stay visible and never start another attempt.
 */
export const initialize = runtime.fn<void>()(
  Effect.fn("OAuthSettings.initialize")(function* (_, get) {
    const url = new URL(location.href);

    if (url.pathname === "/oauth-settings/callback")
      return yield* get.setResult(complete, undefined);
    if (url.pathname === "/sign-in") {
      yield* Effect.sync(() => history.replaceState(null, "", "/sign-in"));
      yield* get.setResult(
        begin,
        url.searchParams.get("select_account") === "1" ? "switch" : "sign-in",
      );
    }
  }),
);

export const unlink = runtime.fn<string>()(
  Effect.fn("OAuthSettings.unlink")(function* (credentialId, get) {
    get.set(notice, null);
    yield* get.setResult(auth.unlinkAccount, { credentialId, commandId: yield* randomUUID });
    get.set(cursor, undefined);
    get.set(
      notice,
      "Sign-in method removed. Sessions have been invalidated. Sign in with a remaining identity.",
    );
  }),
);

export const signOut = runtime.fn<void>()(
  Effect.fn("OAuthSettings.signOut")(function* (_, get) {
    yield* get.setResult(auth.signOut, undefined);
    get.set(attempt, null);
    get.set(cursor, undefined);
    get.set(
      notice,
      "Signed out of Yielded. App access expires within five minutes; sign out in the app to end it immediately.",
    );
  }),
);
