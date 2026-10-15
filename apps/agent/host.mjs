import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Scope } from "../auth/src/shared/scopes.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(here, "hosting.json"), "utf8"));
const auth = { ...config.auth, AUTH_HOSTED_MODEL_SCOPE: Scope.make("agent:hosted-model") };
const source = path.resolve(here, "../../.sources/agent");
const command = process.argv[2];

if (!["prepare", "plan", "deploy"].includes(command))
  throw new Error("Expected prepare, plan or deploy");
if (!/^[a-f0-9]{40}$/.test(config.revision))
  throw new Error("Pin a full Agent commit SHA before preparing a deployment");

function run(cmd, args, cwd = source, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed (${result.status})`);
}

if (command === "prepare") {
  mkdirSync(path.dirname(source), { recursive: true });
  if (!existsSync(source))
    run("git", ["clone", "--no-checkout", config.repository, source], path.dirname(source));
  run("git", ["fetch", "origin", config.revision]);
  run("git", ["checkout", "--detach", config.revision]);
  run("vp", ["install", "--frozen-lockfile"]);
}
const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" });

if (revision.status !== 0 || revision.stdout.trim() !== config.revision)
  throw new Error("Run vp run prepare:source before planning or deploying");

const generated = path.join(source, ".site");

mkdirSync(generated, { recursive: true });
writeFileSync(
  path.join(generated, "planner.alchemy.ts"),
  `import { plannerStack } from "../examples/travel-planner/deployment";\nexport default plannerStack(${JSON.stringify({ ...config.planner, rootDir: path.join(source, "examples/travel-planner") }, null, 2)});\n`,
);
writeFileSync(
  path.join(generated, "browser.wrangler.json"),
  JSON.stringify(
    {
      ...config.browser,
      vars: { ...auth, AUTH_REQUIRED_SCOPE: Scope.make("agent:browser-use"), LAB_PUBLIC: "true" },
    },
    null,
    2,
  ),
);

if (command !== "prepare") {
  if (command === "deploy" && !process.env.AUTH_YIELDED_CLIENT_SECRET)
    throw new Error("AUTH_YIELDED_CLIENT_SECRET is required");
  const plannerEnv = { ...auth, AUTH_REQUIRED_SCOPE: Scope.make("agent:planner") };
  const planner = path.join(source, "examples/travel-planner");

  run(
    "vp",
    [
      "exec",
      "alchemy",
      command,
      path.join(generated, "planner.alchemy.ts"),
      "--stage",
      "production",
      ...(command === "deploy" ? ["--yes"] : []),
    ],
    planner,
    plannerEnv,
  );
  const browser = path.join(source, "examples/browser-speed");

  run("vp", ["run", "build"], browser);
  if (command === "deploy") {
    // Feed the one new binding on stdin; existing hosted-model secrets stay in Cloudflare.
    const secret = spawnSync(
      "vp",
      [
        "exec",
        "wrangler",
        "secret",
        "bulk",
        "--config",
        path.join(generated, "browser.wrangler.json"),
      ],
      {
        cwd: browser,
        env: process.env,
        input: JSON.stringify({
          AUTH_YIELDED_CLIENT_SECRET: process.env.AUTH_YIELDED_CLIENT_SECRET,
        }),
        stdio: ["pipe", "inherit", "inherit"],
      },
    );

    if (secret.error) throw secret.error;
    if (secret.status !== 0)
      throw new Error("Could not configure the browser example's Site client secret");
  }
  run(
    "vp",
    [
      "exec",
      "wrangler",
      "deploy",
      "--config",
      path.join(generated, "browser.wrangler.json"),
      ...(command === "plan" ? ["--dry-run"] : []),
    ],
    browser,
  );
}
