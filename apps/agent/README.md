# Hosted Agent examples

Site owns the deployed Yielded example configuration in `hosting.json`: hostnames,
Worker identities, scope policy and the exact Agent source revision. The Agent
repository keeps the reusable travel-planner and browser-use examples and their
generic deployment code. Both consume Site's gateway and signed access tokens.

```sh
vp -C apps/agent run prepare:source
vp -C apps/agent run plan
vp -C apps/agent run deploy
```

Preparation checks out the pinned commit into the ignored `.sources/agent` directory,
installs its frozen dependencies and writes deployment entries under `.site` inside
that checkout. Planning uses the existing Alchemy stack `effect-agent-travel-planner`
at stage `production`, then performs a browser Worker dry run. Deployment preserves
both Worker names, Durable Object identities, artifact namespace, R2 and BYOK data.
The production `/auth/*` route belongs to Site's Auth stack.

Supply `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, the existing
`BYOK_ENCRYPTION_KEY`, and `AUTH_YIELDED_CLIENT_SECRET` (matching Site's
`YIELDED_AGENT_CLIENT_SECRET`). `SERVER_OPENAI_KEY` is optional for the planner.
The browser Worker retains its existing `FUNDED_OPENAI_API_KEY`; the deploy command
sets only its Site client-secret binding via stdin. Never replace existing data
keys during a repository move.

The manual `Deploy Agent examples` workflow uses Site repository secrets
`AGENT_BYOK_ENCRYPTION_KEY`, `AGENT_OPENAI_KEY` and `AUTH_AGENT_CLIENT_SECRET`, plus
the existing Cloudflare credentials. Copy the existing key values into Site's
secret configuration before the first deployment. The former Agent-hosted deploy
workflow is removed so one repository owns production configuration.

For the initial migration, review both deployment plans and release the Auth
library first. In one coordinated cutover, deploy the Agent archive and consumers
before deploying Site's gateway. Site needs the archive's migration endpoints to
exist before it takes over `/auth/*`; sign-in is unavailable between these steps.
Old example cookies require one Yielded sign-in. Keep `PlannerAuthV2` archived for
identity mapping and legacy data recovery. Normal development of the examples
uses their generic local entry points in the Agent repository.
