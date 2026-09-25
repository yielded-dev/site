/**
 * Converts VitePress Markdown to Starlight Markdown in place.
 *
 *   bun scripts/migrate-vitepress.ts <docs-content-dir>
 *
 * - Moves a leading `# Heading` into `title` frontmatter (Starlight renders the title itself).
 * - Rewrites `::: tip|info|warning|danger [Title]` containers to Starlight asides, and
 *   `::: details [Title]` to `<details>`.
 * - Rewrites VitePress code titles (```ts [file.ts]) to Expressive Code (```ts title="file.ts").
 *
 * Pages using `layout: home`, `<<<` snippet imports, or Vue components need manual attention;
 * the script lists them.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];

if (root === undefined) {
  console.error("usage: bun scripts/migrate-vitepress.ts <docs-content-dir>");
  process.exit(1);
}

const asideTypes: Record<string, string> = {
  tip: "tip",
  info: "note",
  note: "note",
  warning: "caution",
  caution: "caution",
  danger: "danger",
};

const walk = (dir: string): Array<string> =>
  readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);

    if (statSync(file).isDirectory()) return walk(file);

    return /\.mdx?$/.test(name) ? [file] : [];
  });

const yamlString = (value: string) =>
  /^[\w .,()/&-]+$/.test(value) && !/^\s|\s$/.test(value) ? value : JSON.stringify(value);

const convertContainers = (body: string) => {
  const lines = body.split("\n");
  const stack: Array<"aside" | "details"> = [];
  let fence: string | undefined;

  return lines
    .map((line) => {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);

      if (fenceMatch !== null) {
        const marker = fenceMatch[1] ?? "";

        if (fence === undefined) {
          fence = marker;

          return line.replace(
            /^(\s*[`~]{3,}\S*)\s+\[([^\]]+)\]/,
            (_, open: string, title: string) => `${open} title=${JSON.stringify(title)}`,
          );
        }

        if (marker.startsWith(fence)) fence = undefined;

        return line;
      }

      if (fence !== undefined) return line;

      const open = /^:::\s*(\w+)(?:\s+(.*?))?\s*$/.exec(line);

      if (open !== null) {
        const [, type = "", title] = open;

        if (type === "details") {
          stack.push("details");

          return `<details>\n<summary>${title ?? "Details"}</summary>\n`;
        }

        const aside = asideTypes[type];

        if (aside !== undefined) {
          stack.push("aside");

          return title === undefined ? `:::${aside}` : `:::${aside}[${title}]`;
        }
      }

      if (/^:::\s*$/.test(line) && stack.length > 0) {
        return stack.pop() === "details" ? "\n</details>" : ":::";
      }

      return line;
    })
    .join("\n");
};

for (const file of walk(root)) {
  const source = readFileSync(file, "utf8");
  const frontmatterMatch = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  let frontmatter = frontmatterMatch?.[1] ?? "";
  let body = frontmatterMatch === null ? source : source.slice(frontmatterMatch[0].length);
  const notes: Array<string> = [];

  if (/^layout:\s*home/m.test(frontmatter))
    notes.push("layout: home (convert to template: splash)");
  if (/^<<<\s/m.test(body)) notes.push("<<< snippet imports");
  if (/^\s*<[A-Z][A-Za-z]+/m.test(body)) notes.push("Vue components");

  if (!/^title:/m.test(frontmatter)) {
    const heading = /^\s*#\s+(.+?)\s*#*\s*\n/.exec(body);

    if (heading !== null) {
      frontmatter = `title: ${yamlString(heading[1] ?? "")}${frontmatter === "" ? "" : `\n${frontmatter}`}`;
      body = body.slice(heading[0].length).replace(/^\n+/, "");
    } else {
      notes.push("no title");
    }
  }

  body = convertContainers(body);

  writeFileSync(file, `---\n${frontmatter}\n---\n\n${body}`);
  console.log(`${path.relative(root, file)}${notes.length > 0 ? `  ⚠ ${notes.join(", ")}` : ""}`);
}
