import { Scope } from "@yielded/auth";
import { Schema } from "effect";

export const OpenId = Scope.make("openid");
export const Profile = Scope.make("profile");
export const Email = Scope.make("email");
export const AgentPlanner = Scope.make("agent:planner");
export const AgentBrowserUse = Scope.make("agent:browser-use");
export const AgentHostedModel = Scope.make("agent:hosted-model");

export const agentScopes = [OpenId, Profile, AgentPlanner, AgentBrowserUse, AgentHostedModel];
export const authScopes = [...agentScopes, Email];

export const AgentScope = Schema.Literals(agentScopes);
export const AuthScope = Schema.Literals(authScopes);
