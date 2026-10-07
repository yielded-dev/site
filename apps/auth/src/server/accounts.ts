import { Sessions } from "@yielded/auth";
import { PersistenceMappingError } from "@yielded/auth-persistence";
import * as Mapping from "@yielded/auth-persistence/OAuthPersistence";
import { Crypto, Effect, Schema } from "effect";

import {
  authority,
  credential,
  grants,
  type identities,
  logins,
  ownership,
  requirement,
  revocations,
  signInFlow,
  subject,
  subjectId,
} from "./sql";

const { sql, eq } = Mapping;
const string = Schema.decodeUnknownSync(Schema.String);

export const mutableOwnership = {
  ...ownership,
  encodeInsert: ({ identityKey, identity, subjectId }) => ({
    identityKey,
    provider: identity.provider,
    issuer: identity.issuer,
    externalSubject: identity.subject,
    subjectId,
  }),
} satisfies Mapping.OAuthOwnershipTable<typeof identities, string>;

export const mutableCredential = {
  ...credential,
  removal: "delete",
  encodeInsert: (value) => ({ ...value, status: "active" }),
} satisfies Mapping.OAuthCredentialTable<typeof logins, string>;

export const mutableAuthority = {
  ...authority,
  encodeInsert: (value) => ({ ...value, status: "active" }),
} satisfies Mapping.OAuthAuthorityTable<typeof authority.table, string>;

/** Shared app-owned OAuth login mapping; callers select session and metadata policy. */
export const makeAccountsMapping = Effect.fnUntraced(function* () {
  const crypto = yield* Crypto.Crypto;

  const uuid = crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) => PersistenceMappingError.make({ operation: "demo.allocate", cause })),
  );

  return {
    subject: {
      ...subject,
      decodeAuthenticationRequirement: () => requirement,
      nextSecurityRevision: (current) =>
        Sessions.SecurityRevision.make(current === "initial" ? "1" : String(BigInt(current) + 1n)),
    },
    ownership: mutableOwnership,
    credential: mutableCredential,
    authority: mutableAuthority,
    flow: signInFlow,
    subjectId,
    clock: Mapping.clock,
    constraints: Mapping.requiredOAuthSignInConstraints,
    // This demo permits any verified caller to view their own active login methods.
    metadataAccess: () => sql`true`,
    eligibility: [
      Mapping.oauthEligibilityTable<typeof logins, string>({
        table: logins,
        subjectId: "subjectId",
        credentialId: "credentialId",
        revision: "credentialRevision",
        scope: "demo-oauth-logins",
        condition: () => eq(logins.columns.status, "active"),
        decode: (row) => ({
          credentialId: string(row.credentialId),
          revision: Schema.decodeUnknownSync(Sessions.SecurityRevision)(row.credentialRevision),
          usablePrimary: row.status === "active",
          factors: ["possession"],
          userVerified: false,
          phishingResistant: false,
        }),
      }),
    ],
    cleanup: [],
    sessionInvalidation: "original-absolute-expiry",
    otherReferences: ({ identityKey, subjectId }) =>
      sql`exists(select 1 from ${grants} where ${eq(grants.columns.identityKey, identityKey)} and ${eq(grants.columns.subjectId, subjectId)}) or exists(select 1 from ${revocations} where ${eq(revocations.columns.identityKey, identityKey)} and ${eq(revocations.columns.subjectId, subjectId)})`,
    allocateCredentialId: uuid,
    allocateRevision: uuid.pipe(Effect.map((value) => Sessions.SecurityRevision.make(value))),
  } satisfies Mapping.OAuthAccountsMapping<
    typeof subject.table,
    typeof identities,
    typeof logins,
    typeof authority.table,
    typeof signInFlow.table,
    string
  >;
});
