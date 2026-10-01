import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import type { AstroIntegration } from "astro";

import { renderCard, renderIcon } from "./card.ts";
import { getLibrary, type LibraryId } from "./libraries.ts";

export interface LinkPreviewOptions {
  /** The library whose name and accent appear on cards. Omit for the yielded.dev landing page. */
  readonly library?: LibraryId;
}

/**
 * Renders link preview images into the build output.
 *
 * Each built page whose `og:image` points inside the site gets a 1200×630 card at that URL, drawn
 * from its `og:title`, `og:description`, and `article:section`. The output root also receives
 * `apple-touch-icon.png`. Images render after the build, so the dev server does not serve them.
 *
 * ```ts
 * defineConfig({ site: "https://yielded.dev", integrations: [linkPreviews()] })
 * ```
 */
export default function linkPreviews(options: LinkPreviewOptions = {}): AstroIntegration {
  const library = options.library === undefined ? undefined : getLibrary(options.library);
  let siteRoot: string | undefined;

  return {
    name: "@yielded/starlight-theme/link-previews",
    hooks: {
      "astro:config:done"({ config }) {
        siteRoot =
          config.site === undefined
            ? undefined
            : new URL(config.base.replace(/\/?$/, "/"), config.site).href;
      },
      async "astro:build:done"({ dir, logger }) {
        await writeFile(new URL("apple-touch-icon.png", dir), renderIcon());

        if (siteRoot === undefined) {
          logger.warn("Link preview images need `site` in the Astro config.");

          return;
        }

        const pages = (await readdir(dir, { recursive: true })).filter((file) =>
          file.endsWith(".html"),
        );

        const cardRoot = `${siteRoot}og/`;
        let rendered = 0;

        for (const page of pages) {
          const meta = readMeta(await readFile(new URL(page, dir), "utf8"));
          const image = URL.parse(meta.get("og:image") ?? "")?.href;
          const title = meta.get("og:title");

          // A page's own image elsewhere in the site is left untouched.
          if (image === undefined || title === undefined || !image.startsWith(cardRoot)) continue;

          const target = new URL(image.slice(siteRoot.length), dir);

          const card = {
            title,
            description: meta.get("og:description"),
            section: meta.get("article:section"),
          };

          await mkdir(new URL(".", target), { recursive: true });
          await writeFile(target, await renderCard(card, library));
          rendered += 1;
        }

        logger.info(`Rendered ${rendered} link preview images.`);
      },
    },
  };
}

const metaTag = /<meta\s[^>]*>/gi;
const attribute = /([\w:-]+)="([^"]*)"/g;

// The characters Astro escapes in attribute values.
const entities: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

const decode = (value: string) =>
  value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => entities[entity] ?? entity);

/** The first value of each `property` or `name` meta tag on a built page. */
const readMeta = (html: string): ReadonlyMap<string, string> => {
  const meta = new Map<string, string>();

  for (const [tag] of html.matchAll(metaTag)) {
    const attrs = new Map(
      Array.from(tag.matchAll(attribute), ([, name = "", value = ""]) => [name, decode(value)]),
    );

    const key = attrs.get("property") ?? attrs.get("name");
    const content = attrs.get("content");

    if (key !== undefined && content !== undefined && !meta.has(key)) meta.set(key, content);
  }

  return meta;
};
