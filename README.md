# yielded.dev

The yielded.dev landing page and the shared Starlight theme that every library's docs use.

Each library owns its docs in its own repository and deploys them to its own path:

| Path                 | Source                                   | Deploys with          |
| -------------------- | ---------------------------------------- | --------------------- |
| `yielded.dev/`       | `apps/landing` (this repo)               | Alchemy static site   |
| `yielded.dev/sync/`  | `yielded-dev/sync` → `docs/`             | Wrangler Worker route |
| `yielded.dev/auth/`  | `yielded-dev/auth` → `docs/`             | Alchemy static site   |
| `yielded.dev/agent/` | `effect-agent` → `docs/` (not yet moved) | —                     |

Cloudflare picks the most specific Worker route, so each library's `yielded.dev/<lib>*` route
wins over the landing page's `yielded.dev/*`.

## Layout

- `packages/starlight-theme` — `@yielded/starlight-theme`, a Starlight plugin with the shared
  design tokens, library switcher, and Markdown helpers. See its README.
- `apps/landing` — the static landing page. It uses the theme's tokens and library registry.
- `scripts/migrate-vitepress.ts` — one-off converter for moving a VitePress docs folder to
  Starlight (titles, callouts, code titles).

## Adding a library

1. Add it to `packages/starlight-theme/src/libraries.ts` (name, path, accent, install command).
   Mark it `status: "soon"` until its docs are live.
2. In the library's repository, add a `docs/` Starlight workspace using
   `yieldedTheme({ library: "<id>" })` and a Worker route for `yielded.dev/<id>*`.
3. Publish the theme and redeploy the landing page and the other docs sites so their switchers
   pick it up.

## Commands

```sh
vp install
vp run patch:tsgo
vp run dev     # landing page
vp run ready   # format, lint, typecheck, and build
```

See [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md) for developing the theme against a docs site,
releasing it, and deploying the landing page.
