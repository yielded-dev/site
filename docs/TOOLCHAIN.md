# Repository toolchain

This repository follows the Yielded Bun workspace and Vite+ conventions used by
`yielded-dev/sync`, `yielded-dev/auth`, and Effect Agent. The root `package.json`
catalog is the source of truth for exact shared versions.

| Tool                 | Version         |
| -------------------- | --------------- |
| Bun                  | `1.4.0`         |
| Vite+                | `1.0.0-rc.0`    |
| TypeScript           | `7.0.2`         |
| Effect TypeScript-Go | `0.45.0`        |
| Astro                | `7.3.5`         |
| Starlight            | `0.42.4`        |
| Alchemy              | `2.0.0-beta.79` |
| Effect               | `4.0.0-rc.117`  |

## Development

Run `vp install`, then `vp run patch:tsgo`. The prepare hook installs `.vite-hooks`;
the pre-commit hook runs Vite+ checks on staged TypeScript and JavaScript.
`vp run dev` serves the landing page. `vp run ready` is the handoff gate: formatting,
lint with type-aware rules, each workspace's `typecheck`, the root config typecheck,
and the landing build. Astro validates `.astro` files during the build; `tsc` checks
the TypeScript sources.

### Working on the theme against a docs site

The sync and auth `docs/` workspaces depend on `@yielded/starlight-theme`. To try
unpublished theme changes, point the docs workspace at this checkout with
`"@yielded/starlight-theme": "file:../../site/packages/starlight-theme"` and reinstall.
Bun copies `file:` packages, so reinstall after every theme change:

```sh
rm -rf node_modules/.bun/@yielded+starlight-theme@file* docs/node_modules/@yielded
vp install
```

Do not replace the installed copy with a symlink into this repository; Bun's store
maintenance can delete files through it.

## Releasing the theme

Changesets versions `@yielded/starlight-theme`. Run `vp run changeset` for
consumer-visible changes. The `Release` workflow runs on `main` when the repository
variable `RELEASE_ENABLED` is `true`: it opens a version pull request, and after that
merges it runs `vp run release`, which runs the ready gate and `changeset publish`
with npm provenance through trusted publishing. The workflow authenticates as a
GitHub App (`RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`) so version pull requests
trigger CI.

npm trusted publishing can only be configured for an existing package. Publish the
first version manually from `packages/starlight-theme` with `npm publish --access public`,
then add this repository's `Release` workflow as the package's trusted publisher.

## Deploying the landing page

`alchemy.run.ts` deploys `apps/landing` as the `yielded-landing` static-site Worker on
the `yielded.dev/*` route at stage `prod`, using the account-wide Cloudflare state
store like the other Yielded stacks. Cloudflare selects the most specific route, so
the library routes (`yielded.dev/sync*`, `yielded.dev/auth*`) keep serving their docs.
The auth stack owns the proxied apex DNS placeholder record the routes rely on.

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, then run
`vp run plan --stage prod` to review changes or `vp run deploy --stage prod --yes`
to deploy. The `Deploy` workflow runs on relevant changes to `main` with the same
repository secrets.
