import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { lifecycleActions } from "../src/core.js";

const configPath = resolve(new URL("../agent-monitor.config.json", import.meta.url).pathname);
const runningChildren = new Map();

export function createLocalProcessProvider() {
  return {
    id: "local-process",
    label: "Local processes",
    source: "local",
    recordsHistory: false,
    capabilities: ["list", "start", "stop", "interrupt", "end", "force-end"],
    async listAgents() {
      const configuredAgents = await readConfiguredAgents();
      const processes = await listProcesses();
      return configuredAgents.map((agent) => toProcessAgent(agent, processes));
    },
    async performAction(agentId, actionId, prompt = "") {
      const configuredAgents = await readConfiguredAgents();
      const agent = configuredAgents.find((item) => item.id === agentId);
      if (!agent) return null;

      if (actionId === "start") {
        startAgent(agent);
      } else {
        await signalAgent(agent, actionId, prompt);
      }

      const processes = await listProcesses();
      return toProcessAgent(agent, processes);
    }
  };
}

export async function hasLocalProcessConfig() {
  return (await readConfiguredAgents()).length > 0;
}

async function readConfiguredAgents() {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (!Array.isArray(config.localAgents)) return [];
    return config.localAgents
      .filter((agent) => agent.id && agent.name && agent.command)
      .map((agent) => ({
        ...agent,
        match: agent.match || agent.command,
        cwd: agent.cwd || "."
      }));
  } catch {
    return [];
  }
}

function startAgent(agent) {
  if (runningChildren.has(agent.id)) return;

  const child = spawn(agent.command, agent.args || [], {
    cwd: resolve(new URL("..", import.meta.url).pathname, agent.cwd),
    detached: false,
    env: { ...process.env, ...(agent.env || {}) },
    stdio: "ignore"
  });

  child.unref();
  runningChildren.set(agent.id, child);
  child.once("exit", () => runningChildren.delete(agent.id));
}

async function signalAgent(agent, actionId) {
  const child = runningChildren.get(agent.id);
  const processes = await listProcesses();
  const processInfo = findMatchingProcess(agent, processes);
  const pid = child?.pid || processInfo?.pid;
  if (!pid) return;

  const signal = actionId === "force-end" ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(pid, signal);
  } catch {
    // The target may have exited between snapshot and signal.
  }
}

function toProcessAgent(agent, processes) {
  const processInfo = findMatchingProcess(agent, processes);
  const child = runningChildren.get(agent.id);
  const isRunning = Boolean(processInfo || child);
  const pid = processInfo?.pid || child?.pid || null;

  return {
    id: agent.id,
    name: agent.name,
    provider: "Local Process",
    providerId: "local-process",
    source: "local",
    status: isRunning ? "running" : "ended",
    parentId: agent.parentId || null,
    task: agent.command,
    cpu: processInfo?.cpu || 0,
    memoryMb: processInfo?.memoryMb || 0,
    tokens: 0,
    costUsd: 0,
    startedAt: processInfo?.startedAt || Date.now(),
    endedAt: isRunning ? undefined : Date.now(),
    children: [],
    pid,
    command: agent.command,
    capabilities: lifecycleActions.map((action) => action.id)
  };
}

function findMatchingProcess(agent, processes) {
  return processes.find((processInfo) => processInfo.command.includes(agent.match));
}

async function listProcesses() {
  const output = await run("ps", ["-axo", "pid=,pcpu=,rss=,lstart=,command="]);
  return output
    .trim()
    .split("\n")
    .map(parseProcessLine)
    .filter(Boolean);
}

function parseProcessLine(line) {
  const match = line.match(
    /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/
  );
  if (!match) return null;

  const [, pid, cpu, rssKb, dayName, month, day, time, year, command] = match;
  const startedAt = Date.parse(`${dayName} ${month} ${day} ${time} ${year}`);
  return {
    pid: Number(pid),
    cpu: Number(cpu),
    memoryMb: Math.round(Number(rssKb) / 1024),
    startedAt: Number.isNaN(startedAt) ? Date.now() : startedAt,
    command
  };
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
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
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr || `${command} exited with ${code}`));
    });
  });
}
