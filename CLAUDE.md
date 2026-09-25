# Repository guidance

Read `README.md` and `docs/TOOLCHAIN.md` before changing repository structure or
tooling. This repository holds the yielded.dev landing page and
`@yielded/starlight-theme`, the Starlight plugin every library's docs use. Docs
content lives in each library's own repository. Keep documentation independent of
issue trackers and ticket identifiers.

## Commands

Vite+ is the command authority; Bun is the package manager and script runtime.
Use `vp install`, `vp fmt`, `vp lint`, and `vp run <task>`.
Do not invoke wrapped compilers, formatters, or linters directly.
Run `vp help` for available commands and consult `node_modules/vite-plus/docs`.
Use `vp env doctor` for toolchain troubleshooting.

The root catalog owns exact shared dependency versions. Use `catalog:` for shared
dependencies and `workspace:*` for internal packages, except in the published
theme manifest (see below). After dependency changes, run `vp install` and the
relevant verification.

Before handoff, run `vp run ready`. CI runs the same command after a frozen install
and explicit compiler setup.

## Boundaries

- `packages/starlight-theme` is published to npm and consumed by the sync and auth
  docs. Its plugin options, exports, `Snippet` component, `--yl-*` custom properties,
  and Markdown behavior (link rewriting, `{{KEY}}` replacements, includes) are public
  API. Record consumer-visible changes with a changeset.
- Keep the theme manifest's dependency ranges explicit, without `catalog:` or
  `workspace:`. It publishes with `changeset publish` and is also installed from a
  local path while developing a docs site.
- `libraries.ts` is the single source for library names, paths, accents, taglines,
  and install commands. The header switcher, docs footer, and landing page read it.
- The landing page lives in `apps/landing` and deploys through `alchemy.run.ts` to
  `yielded.dev/*`. Library docs deploy from their own repositories on more specific
  `yielded.dev/<library>*` routes.
- Copy quotes the libraries' READMEs and docs or states checkable facts (license,
  runtime, release status). Do not write marketing claims or taglines.
- Landing snippets in `apps/landing/src/snippets` are verbatim copies of library
  examples; update them when the source examples change.

## Effect

Only `alchemy.run.ts` uses Effect. Before editing it, read
`node_modules/effect/AGENTS.md` completely and follow its relevant links. Use
`.agents/skills/effect-development` for focused guidance.

## Testing policy

Default to no new tests or test infrastructure. Verify theme and landing changes
with `vp run ready`, then build a consumer docs site (sync or auth) against the
local theme and check the affected pages in a browser in dark, light, and narrow
layouts. Load [testing](.agents/skills/testing/SKILL.md) before adding committed
automation; it requires a current regression or an explicit human request.

## Skills and pull requests

Use [design-ui](.agents/skills/design-ui/SKILL.md) for visual work. Use
[open-pull-request](.agents/skills/open-pull-request/SKILL.md) for concise PR
descriptions; include screenshots for visual changes. Opening a PR does not
authorize merging it.

Contributor skills in `.agents/skills` are repository tooling, not runtime modules.
Dev Kit copies record their source in `.dev-kit-origin.json`. Update them explicitly with
the transient Dev Kit CLI when requested; the repository does not depend on Dev Kit
for installation, checks, builds, or CI.
