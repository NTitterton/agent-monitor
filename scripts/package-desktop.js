import { rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const appDir = resolve(rootDir, "dist/Agent Monitor.app");
const zipPath = resolve(rootDir, "dist/Agent Monitor.zip");

await assertDirectory(appDir);
await rm(zipPath, { force: true });

const result = spawnSync("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  appDir,
  zipPath
], {
  encoding: "utf8",
  stdio: "pipe"
});

if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || `ditto exited with ${result.status}`);
}

const zipStat = await stat(zipPath).catch(() => null);
if (!zipStat?.isFile() || zipStat.size === 0) {
  throw new Error(`Desktop package was not created: ${zipPath}`);
}

assertZipEntries(zipPath, [
  "Agent Monitor.app/",
  "Agent Monitor.app/Contents/Info.plist",
  "Agent Monitor.app/Contents/MacOS/AgentMonitor",
  "Agent Monitor.app/Contents/PkgInfo"
]);

console.log(`Packaged ${zipPath}`);

async function assertDirectory(path) {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isDirectory()) {
    throw new Error(`Missing desktop app bundle: ${path}. Run npm run desktop:build first.`);
  }
}

function assertZipEntries(path, expectedEntries) {
  const result = spawnSync("unzip", ["-Z1", path], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `unzip exited with ${result.status}`);
  }

  const entries = new Set(result.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean));
  for (const expectedEntry of expectedEntries) {
    if (!entries.has(expectedEntry)) {
      throw new Error(`Desktop package missing ${expectedEntry}`);
    }
  }
}
