import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const appDir = resolve(rootDir, "dist/Agent Monitor.app");
const executablePath = resolve(appDir, "Contents/MacOS/AgentMonitor");
const plistPath = resolve(appDir, "Contents/Info.plist");
const pkgInfoPath = resolve(appDir, "Contents/PkgInfo");
const swiftPath = resolve(rootDir, "desktop/macos/AgentMonitor.swift");

await assertDirectory(appDir, "desktop app bundle");
await assertExecutable(executablePath);
await assertFileContains(plistPath, [
  "<string>AgentMonitor</string>",
  "<string>local.agent-monitor.desktop</string>",
  "<string>Agent Monitor</string>",
  "<string>APPL</string>"
]);
await assertFileContains(pkgInfoPath, ["APPL????"]);
await assertFileContains(swiftPath, [
  "candidatePorts = Array(5173...5183)",
  "/api/health",
  "isAgentMonitorRunning(on:",
  "isPortOpen",
  "captureServerOutput(stdout)",
  "captureServerOutput(stderr)",
  "startupDiagnostics()",
  "No server output was captured"
]);

console.log(`Verified ${appDir}`);

async function assertDirectory(path, label) {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isDirectory()) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function assertExecutable(path) {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new Error(`Missing desktop executable: ${path}`);
  }
  await access(path, constants.X_OK);
}

async function assertFileContains(path, expectedValues) {
  const value = await readFile(path, "utf8").catch((error) => {
    throw new Error(`Could not read ${path}: ${error.message}`);
  });

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      throw new Error(`${path} missing expected value ${expected}`);
    }
  }
}
