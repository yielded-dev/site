/// <reference types="@astrojs/starlight" />
// Starlight's entry types declare `Astro.locals.starlightRoute` for route middleware.

declare module "virtual:yielded/library" {
  // Mirrors `LibraryId` in libraries.ts; ambient modules cannot import relative files.
  const library: "agent" | "auth" | "sync";

  export default library;
  /** Absolute path of the docs project root, which `<Snippet src>` paths resolve from. */
  export const root: string;
}

// Plain `tsc` does not understand `.astro` files; the Astro language server does.
declare module "*.astro" {
  const Component: (props: Record<string, unknown>) => unknown;

  export default Component;
}
