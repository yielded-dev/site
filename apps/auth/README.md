# Yielded sign-in

The application behind `auth.yielded.dev`. GitHub authenticates the shared Yielded
account; registered applications exchange an OpenID code and create their own
sessions. [application.ts](src/application.ts) composes public `@yielded/auth`
services, application policy, SQL storage and consent. Effect Atom owns the browser
workflows. React renders and dispatches.

This host provisions one configured GitHub owner and registers Yielded Agent.
Account settings list, link and remove login identities. Provider tokens remain
private and are not retained as API grants. Recent authentication authorizes
account changes; unlink invalidates Auth sessions and cannot remove the last
usable sign-in method. Provisioning runs once and never restores removed links.

## Development

From the repository root:

```sh
git submodule update --init
vp install
vp run patch:tsgo
AUTH_DATA_DIR=/tmp/yielded-site-auth vp -C apps/auth run start
```

Supply these server-side environment variables through your secret manager:

| Variable                      | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `GITHUB_CLIENT_ID`            | GitHub OAuth App client ID                                  |
| `GITHUB_CLIENT_SECRET`        | Its private client secret                                   |
| `GITHUB_USER_ID`              | The initial owner's stable numeric GitHub ID                |
| `YIELDED_AGENT_CLIENT_SECRET` | Shared only with Agent's confidential OpenID client         |
| `YIELDED_DISPLAY_NAME`        | Account display name; defaults to `Yielded member` locally  |
| `AUTH_ORIGIN`                 | Browser-visible origin; defaults to `http://localhost:4185` |
| `AUTH_PORT`                   | Loopback port; defaults to `4185`                           |
| `YIELDED_AGENT_ORIGIN`        | Agent origin; defaults to `https://agent.yielded.dev`       |

Register `${AUTH_ORIGIN}/oauth-settings/callback` in the GitHub app. Retain any
callbacks used by Agent's direct GitHub sign-in. Auth registers OpenID client
`yielded-agent` with the exact callback
`${YIELDED_AGENT_ORIGIN}/travel/auth/yielded/callback`; Agent supplies the matching
secret as `AUTH_YIELDED_CLIENT_SECRET` and uses `AUTH_ORIGIN` as issuer.

Open `/oauth-settings` to manage identities, or start at Agent's **Continue with
Yielded** button. `/sign-in` automatically starts GitHub when a fresh authentication
is required. An existing Auth session meeting Agent's age requirement returns
directly. Explicit account selection and additional permissions retain consent.
Only Agent's exact callback and `openid profile` scopes are preapproved.

Local development uses SQLite and creates private session, transaction, binding,
consent and RSA signing keys under `AUTH_DATA_DIR`. Keep `auth.sqlite`,
`oauth-settings-keys.json` and `yielded-identity-keys.json` together across restarts.
Reset only disposable local data and its browser cookies when starting over.
Production uses Durable Object SQLite with injected stable keys.

## Deployment

The independent [Alchemy stack](alchemy.run.ts) owns Worker `yielded-auth`, stage
`production`, and the `auth.yielded.dev` custom domain. The landing page has its
own deployment. From the repository root:

```sh
vp -C apps/auth run plan
vp -C apps/auth run deploy --yes
```

Provide `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, the GitHub variables,
`YIELDED_DISPLAY_NAME`, `YIELDED_AGENT_CLIENT_SECRET`, and the secret JSON bindings
`AUTH_SETTINGS_KEYS` and `AUTH_IDENTITY_KEYS`. Their schemas live in
[keys.ts](src/keys.ts) and [identity-keys.ts](src/identity-keys.ts). Reuse the existing
production keys when changing code or repository; local startup keys do not replace
them. Never place secret values in browser build variables or command arguments.

`Deploy auth` reads matching repository secrets prefixed `AUTH_` for the GitHub
client secret, Agent client secret, settings keys and identity keys. Repository
variables `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_USER_ID` and `AUTH_DISPLAY_NAME`
provide public configuration. The Cloudflare secrets are shared with the existing
site deployment. Manual dispatch deploys the selected ref; automatic deployment
on `main` requires `AUTH_DEPLOY_ENABLED=true`.

Preserve stack `yielded-auth`, resource `Auth`, binding `AUTH`, Durable Object
resource `AuthV1`, class `HostedAuth`, and instance `yielded-auth-v1`. They identify
existing storage. SQL table names, subject/module IDs and cookie names are also
stable across this repository move. The host supplies the complete Durable Object
storage so credential and authority changes share one transaction owner. Request
logging and tracing remain disabled to exclude OAuth credentials.

Discovery is `https://auth.yielded.dev/.well-known/openid-configuration`; GitHub's
callback is `https://auth.yielded.dev/oauth-settings/callback`. Each additional
application needs its own exact callback, confidential client secret and policy.
Auth logout revokes subsequent identity access; existing Agent sessions remain
independent. Global logout, public registration and OpenID certification are not
provided by this host.

## Library dependency

The OpenID APIs are currently in [Auth PR #167](https://github.com/yielded-dev/auth/pull/167).
`.dependencies/auth` pins that repository as a Git submodule. Its five runtime
packages resolve through their public exports; no library implementation is copied
or patched here. Site's release configuration excludes them. Once those APIs are
published, replace the source workspaces with the published dependencies.
