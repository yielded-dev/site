import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { slug } from "github-slugger";
import type { Code, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** Values substituted for `{{KEY}}` tokens in Markdown text, code, and link URLs. */
export type Replacements = Readonly<Record<string, string>>;

export interface DocLinksOptions {
  /** Site base without a trailing slash, such as `/sync`. */
  readonly base: string;
  /** Absolute path of the Starlight docs collection, `src/content/docs`. */
  readonly docsDir: string;
}

// Minimal structural types for Sätteri's mdast plugin API, which Astro installs internally.
interface Context {
  setProperty(node: object, key: string, value: unknown): void;
  replaceNode(node: object, replacement: ReadonlyArray<object>): void;
}
interface ValueNode {
  readonly value: string;
}
interface UrlNode {
  readonly url: string;
}
type Visitor<N> = (node: N, context: Context) => void;
interface MdastPlugin {
  readonly name: string;
  readonly text?: Visitor<ValueNode>;
  readonly inlineCode?: Visitor<ValueNode>;
  readonly code?: Visitor<ValueNode>;
  readonly html?: Visitor<ValueNode>;
  readonly link?: Visitor<UrlNode>;
  readonly definition?: Visitor<UrlNode>;
}

export type MdastPluginFactory = (context: {
  readonly fileURL: URL | undefined;
}) => MdastPlugin | undefined;

const hasProtocol = (url: string) => /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith("//");
const pageExtension = /\.mdx?$/;

/**
 * Resolves a link between docs pages to the URL Starlight generates for it.
 *
 * Relative links resolve against the linking file, so `../guide/sessions.md` works the way
 * it does on GitHub and in editors. Root-relative links such as `/guide/sessions` gain the
 * site base. Page paths are slugged like Astro's glob loader, with a trailing slash.
 */
export const resolveDocLink = (
  url: string,
  file: string | undefined,
  { base, docsDir }: DocLinksOptions,
): string => {
  if (url === "" || url.startsWith("#") || url.startsWith("?") || hasProtocol(url)) return url;

  const suffixIndex = url.search(/[?#]/);
  const pathname = suffixIndex === -1 ? url : url.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : url.slice(suffixIndex);
  const isRootRelative = pathname.startsWith("/");

  if (isRootRelative && (pathname === base || pathname.startsWith(`${base}/`))) return url;

  let target: string;

  if (isRootRelative) {
    target = pathname.slice(1);
  } else {
    if (file === undefined) return url;

    const relative = path.relative(docsDir, path.resolve(path.dirname(file), pathname));

    if (relative.startsWith("..") || path.isAbsolute(relative)) return url;
    target = relative.split(path.sep).join("/");
  }

  if (path.posix.extname(target) !== "" && !pageExtension.test(target)) {
    // Assets: prefix public files, leave relative imports to Astro.
    return isRootRelative ? `${base}${pathname}${suffix}` : url;
  }

  const segments = target
    .replace(pageExtension, "")
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => slug(segment));

  if (segments.at(-1) === "index") segments.pop();

  return `${base}/${segments.map((segment) => `${segment}/`).join("")}${suffix}`;
};

export const docLinksPlugin =
  (options: DocLinksOptions): MdastPluginFactory =>
  ({ fileURL }) => {
    const file = fileURL === undefined ? undefined : fileURLToPath(fileURL);

    const visit: Visitor<UrlNode> = (node, context) => {
      const url = resolveDocLink(node.url, file, options);

      if (url !== node.url) context.setProperty(node, "url", url);
    };

    return { name: "yielded-doc-links", link: visit, definition: visit };
  };

export const replacementsPlugin = (replacements: Replacements): MdastPluginFactory => {
  const keys = Object.keys(replacements);

  const pattern = new RegExp(
    `\\{\\{(${keys.map((key) => key.replace(/\W/g, "\\$&")).join("|")})\\}\\}`,
    "g",
  );

  const replace = (value: string) =>
    value.replace(pattern, (token, key: string) => replacements[key] ?? token);

  const visitValue: Visitor<ValueNode> = (node, context) => {
    const value = replace(node.value);

    if (value !== node.value) context.setProperty(node, "value", value);
  };

  const visitUrl: Visitor<UrlNode> = (node, context) => {
    const url = replace(node.url);

    if (url !== node.url) context.setProperty(node, "url", url);
  };

  return () =>
    keys.length === 0
      ? undefined
      : {
          name: "yielded-replacements",
          text: visitValue,
          inlineCode: visitValue,
          code: visitValue,
          html: visitValue,
          link: visitUrl,
          definition: visitUrl,
        };
};

export interface IncludesOptions {
  /** Directory that `@/` include paths resolve from: the Astro project root, `docs/`. */
  readonly root: string;
}

const includePattern = /^<!--\s*@include:\s*(.+?)\s*-->$/;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Extracts a named region from a file, or the whole file without frontmatter.
 * Markdown regions use `<!-- #region name -->`; code files use `// #region name`.
 */
export const readRegion = (file: string, region: string | undefined): string => {
  const source = readFileSync(file, "utf8");

  if (region === undefined) return source.replace(/^---\n[\s\S]*?\n---\n/, "");

  const name = escapeRegExp(region);
  const open = `(?:<!--\\s*#region\\s+${name}\\s*-->|//\\s*#region\\s+${name})[^\\n]*\\n`;
  const close = `\\n[^\\n]*?(?:<!--\\s*#endregion(?:\\s+${name})?\\s*-->|//\\s*#endregion(?:\\s+${name})?)`;
  const match = new RegExp(`${open}([\\s\\S]*?)${close}`).exec(source);

  if (match === null) throw new Error(`Region "${region}" not found in ${file}`);

  return match[1] ?? "";
};

export interface Snippet {
  readonly code: string;
  readonly lang: string;
  readonly title: string | undefined;
}

/**
 * Reads code for the `<Snippet>` component. A Markdown source must contain one fenced
 * code block (its language and title are kept); any other file is used as-is.
 */
export const readSnippet = (file: string, region: string | undefined): Snippet => {
  const text = readRegion(file, region);

  if (!/\.mdx?$/.test(file)) {
    return { code: dedent(text), lang: path.extname(file).slice(1), title: undefined };
  }

  const code = fromMarkdown(text).children.find((node): node is Code => node.type === "code");

  if (code === undefined)
    throw new Error(`No code block in ${file}${region === undefined ? "" : `#${region}`}`);

  const meta = code.meta ?? "";

  const title =
    /^\[([^\]]+)\]/.exec(meta)?.[1] ??
    /title=(?:"([^"]*)"|'([^']*)')/.exec(meta)?.slice(1).find(Boolean);

  return { code: code.value, lang: code.lang ?? "txt", title };
};

const dedent = (text: string): string => {
  const lines = text.replace(/^\n+|\s+$/g, "").split("\n");

  const indent = Math.min(
    ...lines.filter((line) => line.trim() !== "").map((line) => /^\s*/.exec(line)?.[0].length ?? 0),
  );

  return lines.map((line) => line.slice(indent)).join("\n");
};

/** VitePress writes code block titles as `ts [file.ts]`; Starlight uses `ts title="file.ts"`. */
const convertCodeTitle = (node: RootContent): RootContent => {
  if (node.type !== "code") return node;

  const title = /^\[([^\]]+)\]\s*(.*)$/.exec(node.meta ?? "");

  if (title === null) return node;

  const rest = title[2] ?? "";

  const code: Code = {
    ...node,
    meta: `title=${JSON.stringify(title[1])}${rest === "" ? "" : ` ${rest}`}`,
  };

  return code;
};

/**
 * Inlines Markdown from other files: `<!--@include: ../../README.md#region-->`.
 *
 * Paths resolve against the including file, or against the docs project root with `@/`.
 * This keeps examples shared with a README in one place. Only `.md` pages support it;
 * MDX has no HTML comments, so MDX pages import components instead.
 */
export const includesPlugin =
  ({ root }: IncludesOptions): MdastPluginFactory =>
  ({ fileURL }) => {
    if (fileURL === undefined) return undefined;

    const file = fileURLToPath(fileURL);

    return {
      name: "yielded-includes",
      html: (node, context) => {
        const include = includePattern.exec(node.value.trim());

        if (include === null) return;

        const [target = "", region] = (include[1] ?? "").split("#");

        const resolved = target.startsWith("@/")
          ? path.resolve(root, target.slice(2))
          : path.resolve(path.dirname(file), target);

        const tree = fromMarkdown(readRegion(resolved, region), {
          extensions: [gfm()],
          mdastExtensions: [gfmFromMarkdown()],
        });

        context.replaceNode(
          node,
          tree.children.map((child) => {
            delete child.position;

            return convertCodeTitle(child);
          }),
        );
      },
    };
  };
