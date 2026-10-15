import { Schema } from "effect";

export const Scope = Schema.Literals([
  "openid",
  "profile",
  "email",
  "agent:planner",
  "agent:browser-use",
  "agent:hosted-model",
]);

export const AgentScope = Scope.pick([
  "openid",
  "profile",
  "agent:planner",
  "agent:browser-use",
  "agent:hosted-model",
]);
