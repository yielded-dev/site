export type LibraryId = "sync" | "auth" | "agent";

export interface Library {
  readonly id: LibraryId;
  readonly name: string;
  readonly tagline: string;
  readonly description: string;
  /** Path on yielded.dev where the library's docs are served, without a trailing slash. */
  readonly base: `/${string}`;
  readonly repository: string;
  /** Install command shown on the landing page. */
  readonly install: string;
  /** Libraries that are not published yet appear in the switcher without a link. */
  readonly status: "live" | "soon";
  /** Accent colors for dark and light themes. */
  readonly accent: { readonly dark: string; readonly light: string };
}

export const origin = "https://yielded.dev";

export const libraries: ReadonlyArray<Library> = [
  {
    id: "sync",
    name: "Sync",
    tagline: "Realtime state, with receipts.",
    description:
      "Effect-native contracts, an authoritative server, and scoped clients that keep the same command identity through retries.",
    base: "/sync",
    repository: "https://github.com/yielded-dev/sync",
    install: "npm install @yielded/sync@beta",
    status: "live",
    accent: { dark: "#c6f36a", light: "#3f6b00" },
  },
  {
    id: "auth",
    name: "Auth",
    tagline: "Authentication composed with Effect.",
    description:
      "Yielded Auth owns security-sensitive authentication behavior. Applications provide identity authority, persistence, protocol verification, and credential delivery.",
    base: "/auth",
    repository: "https://github.com/yielded-dev/auth",
    install: "npm install @yielded/auth@beta",
    status: "live",
    accent: { dark: "#ffb45e", light: "#9a4a00" },
  },
  {
    id: "agent",
    name: "Agent",
    tagline: "Build TypeScript agents with Effect and Effect AI.",
    description:
      "Define inputs, outputs, and tools with schemas. Effect Agent runs the loop, executes tools, and validates the result, with typed errors, streaming, and bounded execution.",
    base: "/agent",
    repository: "https://github.com/danieljvdm/effect-agent",
    install: "npm install effect-agent@beta",
    status: "soon",
    accent: { dark: "#b9a4ff", light: "#5b3fd1" },
  },
];

export const getLibrary = (id: LibraryId): Library => {
  const library = libraries.find((candidate) => candidate.id === id);

  if (library === undefined) {
    throw new Error(`Unknown yielded.dev library: ${id}`);
  }

  return library;
};
