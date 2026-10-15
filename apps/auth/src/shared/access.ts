import { Schema } from "effect";

export const appScopes = ["agent:planner", "agent:browser-use", "agent:hosted-model"] as const;

export const AccountId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

export const AppClaims = Schema.Struct({ accountId: AccountId, displayName: Schema.String });

export const AppSession = Schema.Struct({
  subjectId: Schema.String,
  ...AppClaims.fields,
  scopes: Schema.Array(Schema.String),
  expiresAtMillis: Schema.Int,
});

export const Grant = Schema.Struct({
  kind: Schema.Literals(["github", "account", "email"]),
  target: Schema.String,
  label: Schema.String,
  grantedAt: Schema.String,
});

export const AccessSettings = Schema.Struct({
  administrator: Schema.Boolean,
  hostedModel: Schema.Boolean,
  grants: Schema.Array(Grant),
});

export const GrantChange = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("grant"),
    username: Schema.String.check(
      Schema.isPattern(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/),
    ),
  }),
  Schema.Struct({
    action: Schema.Literal("revoke"),
    kind: Grant.fields.kind,
    target: Schema.String.check(Schema.isMaxLength(320)),
  }),
]);

export class AccessRejected extends Schema.TaggedError<AccessRejected>()("AccessRejected", {
  reason: Schema.Literals([
    "sign-in",
    "administrator",
    "recent-sign-in",
    "github-user",
    "unavailable",
  ]),
}) {}

export const LegacyAccounts = Schema.Struct({
  accounts: Schema.Array(
    Schema.Struct({
      accountId: AccountId,
      displayName: Schema.String,
      identities: Schema.Array(
        Schema.Struct({
          provider: Schema.Literals(["yielded", "github"]),
          issuer: Schema.String,
          subjectId: Schema.String,
        }),
      ),
    }),
  ),
});

export const LegacyGrants = Schema.Struct({
  grants: Schema.Array(
    Schema.Struct({
      ...Grant.fields,
      version: Schema.Literal(1),
      grantedBy: AccountId,
    }),
  ),
});
