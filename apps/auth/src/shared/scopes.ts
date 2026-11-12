import { OAuthScope } from "@yielded/auth";
import { Schema } from "effect";

export const OpenId = OAuthScope.make("openid");
export const Profile = OAuthScope.make("profile");
export const Email = OAuthScope.make("email");
export const AgentPlanner = OAuthScope.make("agent:planner");
export const AgentBrowserUse = OAuthScope.make("agent:browser-use");
export const AgentSandbox = OAuthScope.make("agent:sandbox");
export const AgentHostedModel = OAuthScope.make("agent:hosted-model");

export const agentScopes = [
  OpenId,
  Profile,
  AgentPlanner,
  AgentBrowserUse,
  AgentSandbox,
  AgentHostedModel,
];

export const authScopes = [...agentScopes, Email];

export const AgentScope = Schema.Literals(agentScopes);
export const AuthScope = Schema.Literals(authScopes);
