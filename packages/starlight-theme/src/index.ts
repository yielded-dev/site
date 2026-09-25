import { fileURLToPath } from "node:url";

import type { StarlightPlugin } from "@astrojs/starlight/types";
import type { AstroIntegration } from "astro";

import tokyoNightLight from "./code-themes/tokyo-night-light.json" with { type: "json" };
import { getLibrary, type LibraryId } from "./libraries.ts";
import {
  docLinksPlugin,
  includesPlugin,
  replacementsPlugin,
  type MdastPluginFactory,
  type Replacements,
} from "./markdown.ts";

export { libraries, getLibrary, origin, type Library, type LibraryId } from "./libraries.ts";

export interface YieldedThemeOptions {
  /** The library these docs belong to. Sets the accent color, switcher state, and defaults. */
  readonly library: LibraryId;
  /** Values substituted for `{{KEY}}` tokens in Markdown, such as the published version. */
  readonly replacements?: Replacements;
}

const resolve = (specifier: string) => fileURLToPath(new URL(specifier, import.meta.url));
const virtualModuleId = "virtual:yielded/library";

/**
 * Starlight plugin shared by every yielded.dev docs site.
 *
 * ```ts
 * starlight({ title: "Yielded Sync", plugins: [yieldedTheme({ library: "sync" })] })
 * ```
 */
export default function yieldedTheme(options: YieldedThemeOptions): StarlightPlugin {
  const library = getLibrary(options.library);

  return {
    name: "@yielded/starlight-theme",
    hooks: {
      "config:setup"({ config, updateConfig, addIntegration }) {
        updateConfig({
          customCss: [
            resolve("./styles/tokens.css"),
            resolve("./styles/theme.css"),
            ...(config.customCss ?? []),
          ],
          components: {
            SiteTitle: resolve("./components/SiteTitle.astro"),
            Hero: resolve("./components/Hero.astro"),
            PageTitle: resolve("./components/PageTitle.astro"),
            Footer: resolve("./components/Footer.astro"),
            ...config.components,
          },
          social:
            config.social !== undefined && config.social.length > 0
              ? config.social
              : [{ icon: "github", label: "GitHub", href: library.repository }],
          editLink:
            config.editLink?.baseUrl !== undefined
              ? config.editLink
              : { baseUrl: `${library.repository}/edit/main/docs/` },
          expressiveCode:
            config.expressiveCode === false
              ? false
              : {
                  themes: ["tokyo-night", { ...tokyoNightLight, type: "light" }],
                  useStarlightUiThemeColors: false,
                  // One-line shell commands read better without an empty terminal title bar.
                  defaultProps: {
                    overridesByLang: { "bash,sh,shell,zsh,shellsession": { frame: "none" } },
                  },
                  styleOverrides: {
                    borderRadius: "0.5rem",
                    borderColor: "var(--sl-color-hairline)",
                    codeFontFamily: "var(--sl-font-mono)",
                    uiFontFamily: "var(--sl-font)",
                    codeBackground: "var(--yl-code-bg)",
                    frames: {
                      shadowColor: "transparent",
                      editorBackground: "var(--yl-code-bg)",
                      editorTabBarBackground: "var(--yl-code-bg)",
                      editorActiveTabBackground: "var(--yl-code-bg)",
                      terminalBackground: "var(--yl-code-bg)",
                      terminalTitlebarBackground: "var(--yl-code-bg)",
                      terminalTitlebarBorderBottomColor: "var(--yl-border)",
                      editorTabBarBorderBottomColor: "var(--yl-border)",
                    },
                  },
                  ...(typeof config.expressiveCode === "object" ? config.expressiveCode : {}),
                },
          head: [
            ...(config.head ?? []),
            {
              // `html:root` outranks the defaults in tokens.css regardless of stylesheet order.
              tag: "style",
              attrs: {},
              content: `html:root{--yl-accent:${library.accent.dark}}html:root[data-theme="light"]{--yl-accent:${library.accent.light}}`,
            },
          ],
        });

        addIntegration(markdownIntegration(options));
      },
    },
  };
}

const markdownIntegration = (options: YieldedThemeOptions): AstroIntegration => ({
  name: "@yielded/starlight-theme/markdown",
  hooks: {
    "astro:config:setup"({ config, updateConfig, logger }) {
      const base = config.base.replace(/\/$/, "");
      const docsDir = fileURLToPath(new URL("content/docs/", config.srcDir));

      const processor = config.markdown.processor as {
        options?: { mdastPlugins?: Array<MdastPluginFactory> };
      };

      const mdastPlugins = processor.options?.mdastPlugins;

      // Includes run first so included content gets replacements, and replacements run before
      // links are rewritten so tokens inside URLs resolve.
      if (Array.isArray(mdastPlugins)) {
        mdastPlugins.push(
          includesPlugin({ root: fileURLToPath(config.root) }),
          replacementsPlugin(options.replacements ?? {}),
          docLinksPlugin({ base, docsDir }),
        );
      } else {
        logger.warn(
          "Markdown links and {{TOKEN}} replacements need Astro's default Sätteri processor.",
        );
      }

      updateConfig({
        vite: {
          plugins: [
            {
              name: "yielded-library",
              resolveId: (id: string) =>
                id === virtualModuleId ? `\0${virtualModuleId}` : undefined,
              load: (id: string) =>
                id === `\0${virtualModuleId}`
                  ? `export default ${JSON.stringify(options.library)};\nexport const root = ${JSON.stringify(fileURLToPath(config.root))};`
                  : undefined,
            },
          ],
        },
      });
    },
  },
});
