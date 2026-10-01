import type { StarlightRouteData } from "@astrojs/starlight/route-data";

/** The label of the sidebar group containing the current page, if any. */
export const currentGroup = (
  entries: StarlightRouteData["sidebar"],
  parent?: string,
): string | undefined => {
  for (const entry of entries) {
    if (entry.type === "link" && entry.isCurrent) return parent;

    if (entry.type === "group") {
      const found = currentGroup(entry.entries, entry.label);

      if (found !== undefined) return found;
    }
  }

  return undefined;
};
