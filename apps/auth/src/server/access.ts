import { timingSafeEqual } from "node:crypto";

import { OAuthServer } from "@yielded/auth";
import { Clock, Context, DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";

import {
  AccessRejected,
  AccessSettings,
  AccountId,
  Grant,
  GrantChange,
  type LegacyAccounts,
  type LegacyGrants,
  appScopes,
} from "../shared/access";
import { moduleId, SettingsAuth } from "./auth";

/** Only the archived DO can supply legacy IDs. Never infer account ownership from names or email. */
export interface LegacyDirectory {
  readonly accounts: (
    subjectId: string,
    githubIds: readonly string[],
  ) => Effect.Effect<typeof LegacyAccounts.Type, AccessRejected>;
  readonly grants: Effect.Effect<typeof LegacyGrants.Type, AccessRejected>;
}

const unavailable = () => AccessRejected.make({ reason: "unavailable" });
const administrator = (subjectId: string) => subjectId === "settings-owner";

const makeAccessPolicy = (issuer: string, legacy?: LegacyDirectory) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`CREATE TABLE IF NOT EXISTS site_app_account (
    app TEXT NOT NULL, subject_id TEXT NOT NULL, account_id TEXT NOT NULL,
    PRIMARY KEY(app, subject_id), UNIQUE(app, account_id))`;
    yield* sql`CREATE TABLE IF NOT EXISTS site_access_grant (
    kind TEXT NOT NULL, target TEXT NOT NULL, label TEXT NOT NULL,
    granted_at TEXT NOT NULL, granted_by TEXT NOT NULL, PRIMARY KEY(kind, target))`;
    yield* sql`CREATE TABLE IF NOT EXISTS site_migration (id TEXT PRIMARY KEY NOT NULL)`;

    const githubIds = Effect.fn("SiteAccess.githubIds")(function* (subjectId: string) {
      const rows = yield* sql`SELECT i."externalSubject" AS id FROM oauth_identity i
      JOIN oauth_subject s ON s.id = i."subjectId" AND s.status = 'active'
      JOIN oauth_login l ON l."identityKey" = i."identityKey" AND l."subjectId" = s.id
        AND l."moduleId" = ${moduleId} AND l.status = 'active'
      JOIN oauth_authority_credential c ON c."subjectId" = s.id
        AND c."credentialId" = l."credentialId" AND c.revision = l."credentialRevision" AND c.status = 'active'
      WHERE s.id = ${subjectId} AND i.provider = 'github' AND i.issuer = 'https://github.com/login/oauth'`;

      return yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(
        rows.map((row) => row.id),
      );
    });

    // One transaction prevents a later import from resurrecting a revoked grant.
    const importGrants = Effect.gen(function* () {
      if (legacy === undefined) return;
      if ((yield* sql`SELECT id FROM site_migration WHERE id = 'agent-grants-v1'`).length > 0)
        return;
      const snapshot = yield* legacy.grants;

      yield* sql.withTransaction(
        Effect.gen(function* () {
          if ((yield* sql`SELECT id FROM site_migration WHERE id = 'agent-grants-v1'`).length > 0)
            return;
          for (const grant of snapshot.grants) {
            yield* sql`INSERT INTO site_access_grant (kind, target, label, granted_at, granted_by)
          VALUES (${grant.kind}, ${grant.target}, ${grant.label}, ${grant.grantedAt}, ${grant.grantedBy})
          ON CONFLICT DO NOTHING`;
          }
          yield* sql`INSERT INTO site_migration (id) VALUES ('agent-grants-v1')`;
        }),
      );
    });

    const account = Effect.fn("SiteAccess.account")(function* (subjectId: string) {
      const saved =
        yield* sql`SELECT account_id FROM site_app_account WHERE app = 'agent' AND subject_id = ${subjectId}`;

      if (saved.length > 0)
        return yield* Schema.decodeUnknownEffect(AccountId)(saved[0]?.account_id);
      const ids = yield* githubIds(subjectId);

      const candidates =
        legacy === undefined ? [] : (yield* legacy.accounts(subjectId, ids)).accounts;

      const exact = candidates.filter((candidate) =>
        candidate.identities.some(
          (identity) =>
            identity.provider === "yielded" &&
            identity.issuer === issuer &&
            identity.subjectId === subjectId,
        ),
      );

      const matches = exact.length > 0 ? exact : candidates;

      if (matches.length > 1) return yield* unavailable();
      const id = matches[0]?.accountId ?? crypto.randomUUID();

      // Both uniqueness constraints are required: races converge, different Site subjects never share data.
      yield* sql`INSERT INTO site_app_account (app, subject_id, account_id) VALUES ('agent', ${subjectId}, ${id}) ON CONFLICT DO NOTHING`;

      const rows =
        yield* sql`SELECT account_id FROM site_app_account WHERE app = 'agent' AND subject_id = ${subjectId}`;

      if (rows.length !== 1) return yield* unavailable();

      return yield* Schema.decodeUnknownEffect(AccountId)(rows[0]?.account_id);
    });

    const hostedModel = Effect.fn("SiteAccess.hostedModel")(function* (subjectId: string) {
      const active =
        yield* sql`SELECT id FROM oauth_subject WHERE id = ${subjectId} AND status = 'active'`;

      if (active.length !== 1) return false;
      if (administrator(subjectId)) return true;
      yield* importGrants;
      const ids = yield* githubIds(subjectId);

      const grants = yield* sql`SELECT kind, target FROM site_access_grant WHERE kind = 'github'
      OR (kind = 'account' AND target IN (SELECT account_id FROM site_app_account WHERE app = 'agent' AND subject_id = ${subjectId}))`;

      return grants.some((grant) => grant.kind === "account" || ids.includes(String(grant.target)));
    });

    return {
      account,
      hostedModel,
      settings: Effect.fn("SiteAccess.settings")(function* (subjectId: string) {
        yield* importGrants;

        const rows = administrator(subjectId)
          ? yield* sql`SELECT kind, target, label, granted_at AS "grantedAt" FROM site_access_grant ORDER BY granted_at DESC, target`
          : [];

        return {
          administrator: administrator(subjectId),
          hostedModel: yield* hostedModel(subjectId),
          grants: yield* Schema.decodeUnknownEffect(Schema.Array(Grant))(rows),
        };
      }),
      change: Effect.fn("SiteAccess.change")(function* (
        subjectId: string,
        change: typeof GrantChange.Type,
      ) {
        if (!administrator(subjectId))
          return yield* AccessRejected.make({ reason: "administrator" });
        yield* importGrants;
        if (change.action === "revoke") {
          yield* sql`DELETE FROM site_access_grant WHERE kind = ${change.kind} AND target = ${change.target}`;

          return;
        }

        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`https://api.github.com/users/${encodeURIComponent(change.username)}`, {
              headers: { accept: "application/vnd.github+json", "user-agent": "yielded-site" },
              signal: AbortSignal.timeout(10_000),
            }),
          catch: unavailable,
        });

        if (response.status === 404) return yield* AccessRejected.make({ reason: "github-user" });
        if (!response.ok) return yield* unavailable();

        const profile = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: unavailable,
        });

        const user = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            id: Schema.Int.check(Schema.isGreaterThan(0)),
            login: Schema.NonEmptyString,
            type: Schema.Literal("User"),
          }),
        )(profile);

        const now = new Date(yield* Clock.currentTimeMillis).toISOString();

        yield* sql`INSERT INTO site_access_grant (kind, target, label, granted_at, granted_by)
        VALUES ('github', ${String(user.id)}, ${user.login}, ${now}, ${subjectId})
        ON CONFLICT(kind, target) DO UPDATE SET label = excluded.label`;
      }),
      accountAllowed: Effect.fn("SiteAccess.accountAllowed")(function* (accountId: string) {
        const rows =
          yield* sql`SELECT subject_id FROM site_app_account WHERE app = 'agent' AND account_id = ${accountId}`;

        return rows.length === 1 && (yield* hostedModel(String(rows[0]?.subject_id)));
      }),
    };
  });

export class AccessPolicy extends Context.Service<
  AccessPolicy,
  Effect.Success<ReturnType<typeof makeAccessPolicy>>
>()("site/AccessPolicy") {
  static layer = (issuer: string, legacy?: LegacyDirectory) =>
    Layer.effect(AccessPolicy, makeAccessPolicy(issuer, legacy));
}

export const authorizationLayer = (resource: string) =>
  Layer.effect(
    OAuthServer.OpenIdAuthorization,
    Effect.gen(function* () {
      const policy = yield* AccessPolicy;
      const sql = yield* SqlClient.SqlClient;

      return OAuthServer.OpenIdAuthorization.of({
        authorize: ({ authentication, clientId, resource: requestedResource, scopes }) =>
          Effect.gen(function* () {
            if (clientId !== "yielded-agent" || requestedResource !== resource)
              return { scopes: [] };
            const accountId = yield* policy.account(authentication.subjectId);
            const funded = yield* policy.hostedModel(authentication.subjectId);

            const rows =
              yield* sql`SELECT "displayName" FROM oauth_account_profile WHERE "subjectId" = ${authentication.subjectId}`;

            return {
              scopes: scopes.filter(
                (scope) =>
                  scope === "openid" ||
                  scope === "profile" ||
                  scope === appScopes[0] ||
                  scope === appScopes[1] ||
                  (scope === appScopes[2] && funded),
              ),
              claims: {
                accountId,
                displayName: yield* Schema.decodeUnknownEffect(Schema.String)(
                  rows[0]?.displayName ?? "Yielded member",
                ),
              },
            };
          }).pipe(Effect.mapError(() => OAuthServer.Unavailable.make({}))),
      });
    }),
  );

export const accessRoutes = (
  origin: string,
  cookieName: string,
  secret: Redacted.Redacted<string>,
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const policy = yield* AccessPolicy;
      const auth = yield* SettingsAuth;

      const session = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const cookie = request.cookies[cookieName];

        if (cookie === undefined) return yield* AccessRejected.make({ reason: "sign-in" });

        return yield* auth
          .verifySession(Redacted.make(cookie))
          .pipe(Effect.mapError(() => AccessRejected.make({ reason: "sign-in" })));
      });

      const protect = <E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) =>
        effect.pipe(
          Effect.catch((error) =>
            HttpServerResponse.json(
              { reason: Schema.is(AccessRejected)(error) ? error.reason : "unavailable" },
              {
                status:
                  Schema.is(AccessRejected)(error) && error.reason !== "unavailable" ? 403 : 503,
              },
            ),
          ),
          Effect.map((response) =>
            HttpServerResponse.setHeader(response, "cache-control", "no-store"),
          ),
        );

      return Layer.mergeAll(
        HttpRouter.add(
          "GET",
          "/api/access",
          protect(
            Effect.gen(function* () {
              const current = yield* session;

              return yield* HttpServerResponse.schemaJson(AccessSettings)(
                yield* policy.settings(current.subjectId),
              );
            }),
          ),
        ),
        HttpRouter.add(
          "POST",
          "/api/access",
          protect(
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;

              if (request.headers.origin !== origin)
                return HttpServerResponse.empty({ status: 403 });
              const current = yield* session;

              if (
                (yield* Clock.currentTimeMillis) -
                  DateTime.toEpochMillis(current.assurance.authenticatedAt) >
                300_000
              )
                return yield* AccessRejected.make({ reason: "recent-sign-in" });
              const change = yield* HttpServerRequest.schemaBodyJson(GrantChange);

              yield* policy.change(current.subjectId, change);

              return yield* HttpServerResponse.schemaJson(AccessSettings)(
                yield* policy.settings(current.subjectId),
              );
            }),
          ),
        ),
        HttpRouter.add(
          "POST",
          "/internal/agent/access",
          protect(
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const encoder = new TextEncoder();
              const supplied = encoder.encode(request.headers.authorization ?? "");
              const expected = encoder.encode(`Bearer ${Redacted.value(secret)}`);

              if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
                return HttpServerResponse.empty({ status: 401 });

              const { accountId } = yield* HttpServerRequest.schemaBodyJson(
                Schema.Struct({ accountId: AccountId }),
              );

              return yield* HttpServerResponse.json({
                allowed: yield* policy.accountAllowed(accountId),
              });
            }),
          ),
        ),
      );
    }),
  );
