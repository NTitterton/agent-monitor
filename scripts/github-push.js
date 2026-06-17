import { spawn } from "node:child_process";

const repoName = process.env.GITHUB_REPO || "agent-monitor";
const visibility = process.env.GITHUB_VISIBILITY || "public";
const branch = process.env.GITHUB_BRANCH || "main";

await main();

async function main() {
  await requireCleanTrackedTree();
  await requireGhAuth();

  const remote = await git(["remote", "get-url", "origin"], { allowFailure: true });
  if (!remote.ok) {
    await createOrAttachRemote();
  }

  await run("git", ["push", "-u", "origin", branch]);
  console.log(`Pushed ${branch} to origin`);
}

async function requireCleanTrackedTree() {
  const status = await git(["status", "--short"]);
  const trackedChanges = status.stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.startsWith("!!"));

  if (trackedChanges.length) {
    throw new Error(`Refusing to push with uncommitted tracked changes:\n${trackedChanges.join("\n")}`);
  }
}

async function requireGhAuth() {
  const auth = await run("gh", ["auth", "status"], { allowFailure: true });
  if (!auth.ok) {
    throw new Error(
      "GitHub authentication is not valid. Run `gh auth login -h github.com`, then rerun `npm run github:push`."
    );
  }
}

async function createOrAttachRemote() {
  const ownerResult = await run("gh", ["api", "user", "--jq", ".login"]);
  const owner = ownerResult.stdout.trim();
  const repo = `${owner}/${repoName}`;
  const repoExists = await run("gh", ["repo", "view", repo, "--json", "name"], { allowFailure: true });

  if (!repoExists.ok) {
    await run("gh", ["repo", "create", repo, `--${visibility}`, "--source", ".", "--remote", "origin"]);
    return;
  }

  await git(["remote", "add", "origin", `https://github.com/${repo}.git`]);
}

function git(args, options = {}) {
  return run("git", args, options);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { ok: code === 0, stdout, stderr, code };
      if (result.ok || options.allowFailure) {
        resolve(result);
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed:\n${stderr || stdout}`));
    });
  });
}
