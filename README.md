<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/wordmark-paper.svg" />
    <img src=".github/assets/wordmark-ink.svg" alt="yielded.dev" height="56" />
  </picture>
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@yielded/starlight-theme"><img alt="npm" src="https://img.shields.io/npm/v/@yielded/starlight-theme?label=starlight-theme&labelColor=121310&color=c6f36a" /></a>
  <a href="https://github.com/yielded-dev/site/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/yielded-dev/site/ci.yml?branch=main&label=ci&labelColor=121310" /></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-f3f1e8?labelColor=121310" /></a>
</p>

<p align="center">
  <a href="https://yielded.dev"><b>yielded.dev</b></a>
  ·
  <a href="https://yielded.dev/sync/">Sync</a>
  ·
  <a href="https://yielded.dev/auth/">Auth</a>
  ·
  <a href="https://effect-agent.com/">Agent</a>
</p>

The yielded.dev landing page and the shared Starlight theme that every library's docs use.

Each library owns its docs in its own repository:

| Path                | Source                       | Deploys with          |
| ------------------- | ---------------------------- | --------------------- |
| `yielded.dev/`      | `apps/landing` (this repo)   | Alchemy static site   |
| `yielded.dev/sync/` | `yielded-dev/sync` → `docs/` | Wrangler Worker route |
| `yielded.dev/auth/` | `yielded-dev/auth` → `docs/` | Alchemy static site   |
| `effect-agent.com`  | `effect-agent` → `docs/`     | Separate deployment   |

Cloudflare picks the most specific Worker route, so each library's `yielded.dev/<lib>*` route
wins over the landing page's `yielded.dev/*`.

## Layout

- `packages/starlight-theme` — `@yielded/starlight-theme`, a Starlight plugin with the shared
  design tokens, library switcher, link preview images, and Markdown helpers. See its README.
- `apps/landing` — the static landing page. It uses the theme's tokens and library registry.
- `scripts/migrate-vitepress.ts` — one-off converter for moving a VitePress docs folder to
  Starlight (titles, callouts, code titles).

## Adding a library

1. Add it to `packages/starlight-theme/src/libraries.ts` (name, path, accent, install command).
   Mark it `status: "soon"` until the library is ready to promote.
2. In the library's repository, add a `docs/` Starlight workspace using
   `yieldedTheme({ library: "<id>" })` and a Worker route for `yielded.dev/<id>*`.
3. Publish the theme and redeploy the landing page and the other docs sites so their switchers
   pick it up.

For docs hosted elsewhere, set the library's `docsUrl` to the canonical HTTPS URL.
The landing page and shared navigation use it instead of the yielded.dev path.

## Commands

```sh
vp install
vp run patch:tsgo
vp run dev     # landing page
vp run ready   # format, lint, typecheck, and build
```

See [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md) for developing the theme against a docs site,
releasing it, and deploying the landing page.
