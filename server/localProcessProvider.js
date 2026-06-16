import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { lifecycleActions } from "../src/core.js";
import { readConfig } from "./config.js";

const runningChildren = new Map();
const discoveryMatchers = [
  { id: "codex", name: "Codex CLI", pattern: /(^|\s|\/)codex(\s|$)/i },
  { id: "claude", name: "Claude CLI", pattern: /(^|\s|\/)claude(\s|$)/i },
  { id: "gemini", name: "Gemini CLI", pattern: /(^|\s|\/)gemini(\s|$)/i },
  { id: "aider", name: "Aider", pattern: /(^|\s|\/)aider(\s|$)/i },
  { id: "goose", name: "Goose", pattern: /(^|\s|\/)goose(\s|$)/i },
  { id: "opencode", name: "OpenCode", pattern: /(^|\s|\/)opencode(\s|$)/i },
  { id: "cursor-agent", name: "Cursor Agent", pattern: /(^|\s|\/)cursor-agent(\s|$)/i },
  { id: "amp", name: "Amp", pattern: /(^|\s|\/)amp(\s|$)/i }
];

export function createLocalProcessProvider() {
  return {
    id: "local-process",
    label: "Local processes",
    source: "local",
    recordsHistory: false,
    capabilities: ["list", "start", "stop", "interrupt", "end", "force-end"],
    async listAgents() {
      const processes = await listProcesses();
      return readLocalProcessAgents(processes);
    },
    async performAction(agentId, actionId, prompt = "") {
      const processes = await listProcesses();
      const agent = (await readLocalProcessAgents(processes)).find((item) => item.id === agentId);
      if (!agent) return null;

      if (actionId === "start" && !agent.discovered) {
        startAgent(agent);
      } else if (actionId !== "start") {
        await signalAgent(agent, actionId, prompt);
      }

      return toProcessAgent(agent, await listProcesses());
    }
  };
}

export async function hasLocalProcessConfig() {
  const config = await readConfig();
  return discoveryEnabled(config) || (await readConfiguredAgents(config)).length > 0;
}

async function readLocalProcessAgents(processes) {
  const config = await readConfig();
  const configuredAgents = await readConfiguredAgents(config);
  const configuredMatches = configuredAgents.map((agent) => agent.match);
  const discoveredAgents = discoveryEnabled(config)
    ? discoverAgents(processes, configuredMatches, config.localDiscovery || {})
    : [];

  const agents = [...configuredAgents, ...discoveredAgents].map((agent) => toProcessAgent(agent, processes));
  return attachProcessLineage(agents);
}

async function readConfiguredAgents(config = null) {
  config = config || (await readConfig());
  if (!Array.isArray(config.localAgents)) return [];
  return config.localAgents
    .filter((agent) => agent.id && agent.name && agent.command)
    .map((agent) => ({
      ...agent,
      match: agent.match || agent.command,
      cwd: agent.cwd || ".",
      discovered: false
    }));
}

function startAgent(agent) {
  if (runningChildren.has(agent.id)) return;

  const child = spawn(agent.command, agent.args || [], {
    cwd: resolve(new URL("..", import.meta.url).pathname, agent.cwd || "."),
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
  const processInfo = agent.pid
    ? processes.find((item) => item.pid === agent.pid)
    : findMatchingProcess(agent, processes);
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
  const processInfo = agent.pid
    ? processes.find((item) => item.pid === agent.pid)
    : findMatchingProcess(agent, processes);
  const child = runningChildren.get(agent.id);
  const isRunning = Boolean(processInfo || child);
  const pid = processInfo?.pid || child?.pid || null;
  const childPids = pid
    ? processes.filter((item) => item.ppid === pid).map((item) => item.pid)
    : [];

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
    parentPid: processInfo?.ppid || null,
    childPids,
    command: agent.command,
    match: agent.match,
    cwd: agent.cwd,
    args: agent.args,
    discovered: Boolean(agent.discovered),
    capabilities: lifecycleActions
      .filter((action) => !agent.discovered || action.id !== "start")
      .map((action) => action.id)
  };
}

function discoverAgents(processes, configuredMatches, options) {
  const includePatterns = (options.include || []).map((pattern) => ({
    id: slugify(pattern),
    name: pattern,
    pattern: new RegExp(pattern, "i")
  }));
  const excludePatterns = (options.exclude || []).map((pattern) => new RegExp(pattern, "i"));
  const matchers = [...discoveryMatchers, ...includePatterns];

  return processes
    .filter((processInfo) => !configuredMatches.some((match) => processInfo.command.includes(match)))
    .filter((processInfo) => !excludePatterns.some((pattern) => pattern.test(processInfo.command)))
    .map((processInfo) => {
      const matcher = matchers.find((item) => item.pattern.test(processInfo.command));
      if (!matcher) return null;

      return {
        id: `local-discovered-${matcher.id}-${processInfo.pid}`,
        name: `${matcher.name} (${processInfo.pid})`,
        command: processInfo.command,
        match: processInfo.command,
        discovered: true,
        pid: processInfo.pid
      };
    })
    .filter(Boolean);
}

function attachProcessLineage(agents) {
  const agentByPid = new Map(agents.filter((agent) => agent.pid).map((agent) => [agent.pid, agent]));

  return agents.map((agent) => {
    const parent = agent.parentPid ? agentByPid.get(agent.parentPid) : null;
    const children = agents
      .filter((candidate) => candidate.parentPid === agent.pid)
      .map((candidate) => candidate.id);

    return {
      ...agent,
      parentId: agent.parentId || parent?.id || null,
      children
    };
  });
}

function discoveryEnabled(config) {
  return config.localDiscovery?.enabled !== false;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent";
}

function findMatchingProcess(agent, processes) {
  return processes.find((processInfo) => processInfo.command.includes(agent.match));
}

async function listProcesses() {
  const output = await run("ps", ["-axo", "pid=,ppid=,pcpu=,rss=,lstart=,command="]);
  return output
    .trim()
    .split("\n")
    .map(parseProcessLine)
    .filter(Boolean);
}

function parseProcessLine(line) {
  const match = line.match(
    /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/
  );
  if (!match) return null;

  const [, pid, ppid, cpu, rssKb, dayName, month, day, time, year, command] = match;
  const startedAt = Date.parse(`${dayName} ${month} ${day} ${time} ${year}`);
  return {
    pid: Number(pid),
    ppid: Number(ppid),
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
