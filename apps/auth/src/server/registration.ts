import { type OAuth, Sessions } from "@yielded/auth";
import * as Mapping from "@yielded/auth-persistence/OAuthPersistence";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

import { Registration } from "../shared/contract";
import { makeAccountsMapping } from "./accounts";
import { subject, subjectId } from "./sql";

const intents = Mapping.table({
  name: "oauth_registration",
  columns: {
    moduleId: { name: "moduleId", type: "text" },
    reference: { name: "reference", type: "text" },
    flowId: { name: "flowId", type: "text" },
    identityKey: { name: "identityKey", type: "text", nullable: true },
    snapshot: { name: "snapshot", type: "text", nullable: true },
    expiresAt: { name: "expiresAt", type: "integer", nullable: true },
    retentionUntil: { name: "retentionUntil", type: "integer", nullable: true },
  },
  unique: [
    ["moduleId", "reference"],
    ["moduleId", "flowId"],
  ],
});

const intent = {
  table: intents,
  moduleId: "moduleId",
  reference: "reference",
  flowId: "flowId",
  identityKey: "identityKey",
  snapshot: "snapshot",
  expiresAt: "expiresAt",
  retentionUntil: "retentionUntil",
  encodeInsert: (value) => ({
    moduleId: value.context.moduleId,
    reference: value.reference,
    flowId: value.context.flowId,
  }),
} satisfies Mapping.OAuthRegistrationIntentTable<typeof intents>;

/** Public GitHub registration provisions a distinct subject, never the seeded owner. */
export const makeRegistrationServices = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;

  yield* client`CREATE TABLE IF NOT EXISTS oauth_registration (
    "moduleId" TEXT NOT NULL, reference TEXT NOT NULL, "flowId" TEXT NOT NULL,
    "identityKey" TEXT, snapshot TEXT, "expiresAt" INTEGER, "retentionUntil" INTEGER,
    UNIQUE("moduleId", reference), UNIQUE("moduleId", "flowId"))`;

  const accounts = yield* makeAccountsMapping();

  const github = (value: typeof OAuth.OAuthRegistrationIntent.Type) =>
    value.identity.provider === "github" &&
    value.identity.issuer === "https://github.com/login/oauth";

  const registrationIntents = yield* Mapping.makeOAuthRegistrationIntentServices({
    ownership: accounts.ownership,
    intent,
    clock: Mapping.clock,
    constraints: {
      intentReference: Mapping.requiredOAuthRegistrationConstraints.intentReference,
      intentFlow: Mapping.requiredOAuthRegistrationConstraints.intentFlow,
      ownership: Mapping.requiredOAuthRegistrationConstraints.ownership,
    },
    eligible: (value) => (github(value) ? Mapping.sql`true` : Mapping.sql`false`),
  });

  const registration = yield* Mapping.makeOAuthRegistrationServices({
    registration: Registration,
    ownership: accounts.ownership,
    credential: accounts.credential,
    authority: accounts.authority,
    intent,
    subject,
    subjectId,
    clock: Mapping.clock,
    constraints: Mapping.requiredOAuthRegistrationConstraints,
    inspect: ({ intent }) =>
      Effect.succeed({
        fingerprint: "yielded-public-github-v1",
        eligible: github(intent),
      }),
    eligibility: {
      admission: ({ intent }) => (github(intent) ? Mapping.sql`true` : Mapping.sql`false`),
      postcondition: () => Mapping.sql`true`,
    },
    allocateSubjectId: accounts.allocateCredentialId,
    allocateCredentialId: accounts.allocateCredentialId,
    allocateRevision: Effect.succeed(Sessions.SecurityRevision.make("initial")),
    encodeSubjectInsert: (_, ids) => ({
      id: ids.subjectId,
      status: "active",
      securityRevision: ids.securityRevision,
    }),
  });

  return { ...registrationIntents, ...registration };
});
