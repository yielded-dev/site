import { Schema as AuthSchema } from "@yielded/auth";
import { Schema } from "effect";

export const AgentIdentityRequest = Schema.Struct({ subjectId: AuthSchema.SubjectId });

export const AgentIdentityResponse = Schema.Struct({
  githubIds: Schema.Array(Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/))),
});
