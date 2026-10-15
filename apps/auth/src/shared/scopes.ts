export const appScope = {
  planner: "agent:planner",
  browserUse: "agent:browser-use",
  hostedModel: "agent:hosted-model",
} as const;

export const appScopes = [appScope.planner, appScope.browserUse, appScope.hostedModel] as const;

export const authScopes = ["openid", "profile", "email", ...appScopes] as const;
