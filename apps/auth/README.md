# Hosted Yielded accounts

Site owns `auth.yielded.dev`, the sign-in gateway at `agent.yielded.dev/auth/*`,
account registration, application permissions and their administrator UI. The
Auth repository supplies reusable protocol and session libraries; it contains no
Yielded application policy.

Anyone can register with GitHub. The first callback creates their Yielded account
and session without a second GitHub exchange. The existing owner remains
`settings-owner`. Account settings at `/oauth-settings` manage linked identities
and app access. Linking, unlinking and permission changes require authentication
within five minutes. Unlinking invalidates the account's sessions.

## Sessions and permissions

The hosted account session lasts up to 30 days. Ordinary application sign-in has
no forced `max_age` and reuses that session. Site's confidential `yielded-agent`
OpenID client exchanges an authorization code with PKCE. Its exact callback is
`https://agent.yielded.dev/auth/yielded/callback`.

Site grants `agent:planner` and `agent:browser-use` to active accounts. Only the
owner and accounts with a hosted-key grant receive `agent:hosted-model`. The owner
can grant a GitHub username before registration; Site resolves and stores the
immutable GitHub user ID. Current linked, active identities determine access.

Access JWTs last five minutes and are restricted to the `https://agent.yielded.dev`
resource. The examples verify the signature, issuer, audience and required scope
locally with cached public keys. They do not call the travel planner to authenticate.
Short-lived JWTs remain usable until expiry after an account change. Durable
hosted-model work additionally calls Site's private `POST /internal/agent/access`
with the existing client secret, preserving immediate permission checks when a
run resumes or requests more model output.

The gateway keeps rotating refresh tokens in a separate Durable Object for each
opaque browser session. Only an HttpOnly session handle and access cookie enter
the browser; JavaScript receives identity and scope metadata from `/auth/session`.
The object serializes refreshes across tabs. A refresh checks current account and
grant state without a GitHub request. A new permission requires another ordinary
application authorization; refresh can retain or reduce the original scopes.

`GET /auth/login?return=/browser-use` starts login. `GET /auth/session` returns
metadata or `null` and renews expired access when possible. `POST /auth/refresh`
renews access; `POST /auth/logout` revokes the grant and clears cookies. Mutations
require the exact application origin. Return destinations are limited to the
configured app origin and example routes.

## Existing accounts and data

The archived `PlannerAuthV2` object remains under its original binding and instance
`auth-v1`. It exposes only private, read-only migration lookups to Site. First
application authorization maps the canonical Yielded subject to its existing
planner UUID using an exact Yielded subject or verified GitHub ID. The signed
`accountId` claim preserves data routing and BYOK encryption context. The canonical
JWT subject remains the Yielded account ID. Mapping conflicts fail closed; names
and email addresses never merge accounts.

Site imports existing hosted-key grants once in a transaction, including Zack's
pregrant. Removing an imported grant cannot restore it on the next request.
Legacy email grants remain visible to the administrator but require an explicit
identity migration before they authorize a GitHub account. Existing accounts with
multiple conflicting legacy owners require explicit resolution before sign-in.
The archive remains intact for that work.

## Development

```sh
vp install
AUTH_DATA_DIR=/tmp/yielded-site-auth vp -C apps/auth run start
```

Configure `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_USER_ID`,
`YIELDED_DISPLAY_NAME` and `YIELDED_AGENT_CLIENT_SECRET`. Local sign-in defaults to
`http://localhost:4185`; override `AUTH_ORIGIN` and `AUTH_PORT` if needed. Register
`${AUTH_ORIGIN}/oauth-settings/callback` with GitHub. `YIELDED_AGENT_ORIGIN` selects
the application's exact origin. Local account settings use SQLite and create
private keys under `AUTH_DATA_DIR`; the application gateway uses the deployed
HTTPS Worker and secure cookies.

`src/server/application.ts` composes Auth services with Site policy;
`access.ts` owns grants and legacy mappings; `gateway.ts` owns the application
session. `src/client/atoms.ts` owns browser queries and workflows; React renders
and dispatches. `src/shared/scopes.ts` declares the branded scope values used by the
issuer, gateway, session schema and example deployments. Shared schemas live in
`src/shared`.

## Deployment

```sh
vp -C apps/auth run plan
vp -C apps/auth run deploy --yes
```

Keep stack `yielded-auth`, stage `production`, Worker `yielded-auth`, resource
`Auth`, binding `AUTH`, Durable Object resource `AuthV1`, class `HostedAuth`, and
instance `yielded-auth-v1`. Keep existing SQL identities, account cookie names,
`AUTH_SETTINGS_KEYS` and `AUTH_IDENTITY_KEYS`. The new `AppSessionsV1` resource is
separate gateway storage. `LEGACY_AGENT_AUTH` references the existing planner
object; it does not replace or recreate it.

Provide Cloudflare credentials, the GitHub configuration above, and the two key
bindings. The `Deploy auth` workflow reads repository secrets prefixed `AUTH_` and
public variables `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_USER_ID`, `AUTH_DISPLAY_NAME`.
Automatic deployment requires `AUTH_DEPLOY_ENABLED=true`. Logging and tracing stay
disabled around authentication credentials.

The initial cutover must deploy the matching Agent archive and consumers first,
then Site's gateway, which needs the archive's migration endpoints. Sign-in is
unavailable between these steps. Site takes ownership of the existing `/auth/*` route. Old
planner login cookies are retired; users sign in through Yielded once. Keep the
archived object and existing BYOK keys throughout. See [hosted examples](../agent/README.md)
for the Site-owned application deployment configuration.

## Library dependency

The root catalog pins published `@yielded/auth`, `@yielded/auth-persistence`,
`@yielded/crypto` and `@yielded/jose` packages. Generic OpenID changes are reviewed
and released in `yielded-dev/auth` before consumers update their pinned versions.
