import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

import { currentGroup } from "./sidebar.ts";

/**
 * Adds each page's `article:section` and points its `og:image` at the card that
 * `link-previews.ts` renders after the build. A page that sets its own non-empty `og:image` in
 * frontmatter `head` keeps it.
 */
export const onRequest = defineRouteMiddleware(({ locals, site }) => {
  const route = locals.starlightRoute;
  const section = currentGroup(route.sidebar);

  if (section !== undefined)
    route.head.push({ tag: "meta", attrs: { property: "article:section", content: section } });

  const hasImage = route.head.some(
    ({ attrs }) =>
      attrs?.property === "og:image" && typeof attrs.content === "string" && attrs.content !== "",
  );

  if (site === undefined || hasImage) return;

  const base = import.meta.env.BASE_URL.replace(/\/?$/, "/");
  const { title } = route.entry.data;

  route.head.push(
    {
      tag: "meta",
      attrs: {
        property: "og:image",
        content: new URL(`${base}og/${route.id || "index"}.png`, site).href,
      },
    },
    { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
    { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
    {
      tag: "meta",
      attrs: {
        property: "og:image:alt",
        content: title === route.siteTitle ? title : `${title} · ${route.siteTitle}`,
      },
    },
  );
});
