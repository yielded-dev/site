import { timingSafeEqual } from "node:crypto";

import { Effect, Layer, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";

import { AgentIdentityRequest, AgentIdentityResponse } from "../shared/agent";
import { moduleId } from "./auth";

/** Agent checks current login identities when applying its own funding grants. */
export const agentIdentityRoutes = (secret: Redacted.Redacted<string>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      return HttpRouter.add(
        "POST",
        "/internal/agent/identities",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const encoder = new TextEncoder();
          const supplied = encoder.encode(request.headers.authorization ?? "");
          const expected = encoder.encode(`Bearer ${Redacted.value(secret)}`);

          if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
            return HttpServerResponse.empty({ status: 401 });

          const { subjectId } = yield* HttpServerRequest.schemaBodyJson(AgentIdentityRequest);

          const rows = yield* sql`SELECT i."externalSubject" AS "githubId"
      FROM oauth_identity i
      JOIN oauth_subject s ON s.id = i."subjectId" AND s.status = 'active'
      JOIN oauth_login l ON l."identityKey" = i."identityKey" AND l."subjectId" = s.id
        AND l."moduleId" = ${moduleId} AND l.status = 'active'
      JOIN oauth_authority_credential c ON c."subjectId" = s.id
        AND c."credentialId" = l."credentialId" AND c.revision = l."credentialRevision"
        AND c.status = 'active'
      WHERE s.id = ${subjectId} AND i.provider = 'github'
        AND i.issuer = 'https://github.com/login/oauth'
      ORDER BY i."externalSubject"`;

          const response = yield* Schema.decodeUnknownEffect(AgentIdentityResponse)({
            githubIds: rows.map((row) => row.githubId),
          });

          return yield* HttpServerResponse.schemaJson(AgentIdentityResponse)(response);
        }).pipe(
          Effect.catchTags({
            SchemaError: () => Effect.succeed(HttpServerResponse.empty({ status: 400 })),
          }),
          Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 503 })),
          Effect.map(HttpServerResponse.setHeader("cache-control", "no-store")),
        ),
      );
    }),
  );
