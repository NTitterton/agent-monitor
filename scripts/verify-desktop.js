import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
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
  "desktopCandidatePorts()",
  "AGENT_MONITOR_DESKTOP_PORT_RANGE",
  "AGENT_MONITOR_DESKTOP_SELF_TEST",
  "/api/health",
  "isAgentMonitorRunning(on:",
  "isPortOpen",
  "captureServerOutput(stdout)",
  "captureServerOutput(stderr)",
  "serverEnvironment(port:",
  "startupDiagnostics()",
  "No server output was captured"
]);
await assertDesktopSelfTest(executablePath);

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

async function assertDesktopSelfTest(path) {
  const output = await runDesktopSelfTest(path);
  if (!/Agent Monitor desktop self-test started http:\/\/127\.0\.0\.1:519[0-8]\//.test(output)) {
    throw new Error(`Desktop self-test did not start the local server as expected. Output:\n${output}`);
  }
}

function runDesktopSelfTest(path) {
  return new Promise((resolveSelfTest, rejectSelfTest) => {
    const child = spawn(path, [], {
      env: {
        ...process.env,
        AGENT_MONITOR_DESKTOP_SELF_TEST: "1",
        AGENT_MONITOR_DESKTOP_PORT_RANGE: "5190-5198"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectSelfTest(new Error(`Desktop self-test timed out. Output:\n${output}`));
    }, 12000);

    child.stdout.on("data", (data) => {
      output += data.toString("utf8");
    });
    child.stderr.on("data", (data) => {
      output += data.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectSelfTest(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolveSelfTest(output);
        return;
      }
      rejectSelfTest(new Error(`Desktop self-test exited with ${code}. Output:\n${output}`));
    });
  });
}
