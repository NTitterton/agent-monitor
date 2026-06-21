import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentActions } from "../src/core.js";
import { readConfig } from "./config.js";

const runningChildren = new Map();
const openCodeDbPath = join(homedir(), ".local/share/opencode/opencode.db");
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
    type: "local",
    recordsHistory: false,
    capabilities: ["list", "start", "stop", "interrupt", "end", "force-end", "go-to"],
    async listAgents() {
      const processes = await listProcesses();
      return readLocalProcessAgents(processes);
    },
    async performAction(agentId, actionId, prompt = "") {
      const processes = await listProcesses();
      const agent = (await readLocalProcessAgents(processes)).find((item) => item.id === agentId);
      if (!agent) return null;

      if (actionId === "go-to") {
        try {
          await goToAgent(agent, processes);
        } catch {
          // Window activation is best-effort and may be blocked by OS permissions.
        }
      } else if (actionId === "start" && !agent.discovered && agent.status !== "running") {
        const configuredAgent = (await readConfiguredAgents()).find((item) => item.id === agentId);
        await startAgent(configuredAgent || agent);
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

async function startAgent(agent) {
  if (runningChildren.has(agent.id)) return runningChildren.get(agent.id);

  let startError = null;
  let child;
  try {
    child = spawn(agent.command, agent.args || [], {
      cwd: resolve(new URL("..", import.meta.url).pathname, agent.cwd || "."),
      detached: false,
      env: { ...process.env, ...(agent.env || {}) },
      stdio: "ignore"
    });
  } catch (error) {
    throw new Error(`Failed to start local agent ${agent.id}: ${error.message}`);
  }

  child.once("error", (error) => {
    startError = error;
    runningChildren.delete(agent.id);
  });

  await new Promise((resolveTimer) => setTimeout(resolveTimer, 25));
  if (startError) {
    throw new Error(`Failed to start local agent ${agent.id}: ${startError.message}`);
  }

  child.unref();
  runningChildren.set(agent.id, child);
  child.once("exit", () => runningChildren.delete(agent.id));
  return child;
}

async function signalAgent(agent, actionId) {
  const child = runningChildren.get(agent.id);
  const processes = await listProcesses();
  const processInfo = agent.pid
    ? processes.find((item) => item.pid === agent.pid)
    : findMatchingProcess(agent, processes);
  const pid = child?.pid || processInfo?.pid;
  if (!pid) return;

  const signal = signalForAction(actionId);
  for (const targetPid of signalPidsForProcessTree(pid, processes)) {
    try {
      process.kill(targetPid, signal);
    } catch {
      // The target may have exited between snapshot and signal.
    }
  }
}

export function signalForAction(actionId) {
  if (actionId === "force-end") return "SIGKILL";
  if (actionId === "interrupt") return "SIGINT";
  return "SIGTERM";
}

function toProcessAgent(agent, processes) {
  const processInfo = agent.pid
    ? processes.find((item) => item.pid === agent.pid)
    : findMatchingProcess(agent, processes);
  const child = runningChildren.get(agent.id);
  const isRunning = Boolean(processInfo || child);
  const pid = processInfo?.pid || child?.pid || null;
  const childProcesses = pid ? descendantProcesses(processes, pid) : [];
  const childPids = childProcesses.map((item) => item.pid);
  const resources = summarizeProcessResources(processInfo, childProcesses);
  const surface = inferLocalSurface(agent, processInfo, processes);
  const localMetadata = inferLocalAgentMetadata(agent, processInfo, processes, surface);

  return {
    id: agent.id,
    name: agent.name,
    provider: "Local Process",
    providerId: "local-process",
    type: "local",
    source: "local",
    status: isRunning ? "running" : "ended",
    parentId: agent.parentId || null,
    task: localMetadata.shortDescription || agent.command,
    shortDescription: localMetadata.shortDescription,
    terminalTitle: localMetadata.terminalTitle,
    currentStep: localMetadata.currentStep,
    contextWindowUsed: localMetadata.contextWindowUsed,
    contextWindowTotal: localMetadata.contextWindowTotal,
    contextWindowConfidence: localMetadata.contextWindowConfidence,
    thinkingSnippet: localMetadata.thinkingSnippet,
    cpu: resources.cpu,
    memoryMb: resources.memoryMb,
    processCpu: resources.processCpu,
    processMemoryMb: resources.processMemoryMb,
    childCpu: resources.childCpu,
    childMemoryMb: resources.childMemoryMb,
    tokens: localMetadata.tokens || 0,
    tokensPerSecond: 0,
    tokenRateWindowMs: 0,
    tokenCountConfidence: localMetadata.tokenCountConfidence || "unknown",
    costUsd: localMetadata.costUsd || 0,
    startedAt: processInfo?.startedAt || Date.now(),
    endedAt: isRunning ? undefined : Date.now(),
    children: [],
    pid,
    parentPid: processInfo?.ppid || null,
    childPids,
    goToTarget: surface.goToTarget,
    goToKind: surface.goToKind,
    windowTitle: localMetadata.terminalTitle || surface.windowTitle,
    logs: buildProcessLogs(agent, processInfo, childPids, isRunning),
    command: agent.command,
    match: agent.match,
    cwd: agent.cwd,
    args: agent.args,
    discovered: Boolean(agent.discovered),
    capabilities: agentActions
      .filter((action) => {
        if (action.id !== "start") return true;
        return !agent.discovered && !isRunning;
      })
      .map((action) => action.id)
  };
}

export function summarizeProcessResources(processInfo, childProcesses = []) {
  const processCpu = roundCpu(processInfo?.cpu || 0);
  const childCpu = roundCpu(childProcesses.reduce((total, item) => total + Number(item.cpu || 0), 0));
  const processMemoryMb = Number(processInfo?.memoryMb || 0);
  const childMemoryMb = childProcesses.reduce((total, item) => total + Number(item.memoryMb || 0), 0);

  return {
    cpu: roundCpu(processCpu + childCpu),
    memoryMb: processMemoryMb + childMemoryMb,
    processCpu,
    processMemoryMb,
    childCpu,
    childMemoryMb
  };
}

export function inferLocalAgentMetadata(agent = {}, processInfo = null, processes = [], surface = null) {
  const commandChain = [
    processInfo,
    ...ancestorProcesses(processes, processInfo?.ppid)
  ]
    .map((item) => item?.command || "")
    .filter(Boolean);
  const commandText = [agent.command, ...(agent.args || []), agent.match, ...commandChain].filter(Boolean).join("\n");
  const openCodeMetadata = /(^|\s|\/)opencode(\s|$)/i.test(commandText) ? readOpenCodeSessionMetadata() : null;
  const shortDescription = normalizeDescription(
    agent.shortDescription ||
      agent.description ||
      openCodeMetadata?.title ||
      extractFlagValue(commandText, ["description", "desc", "title", "task", "prompt", "initial-prompt"]) ||
      extractCodexExecDescription(commandText) ||
      friendlyCommandDescription(agent, processInfo)
  );
  const providerPrefix = /(^|\s|\/)opencode(\s|$)/i.test(commandText) ? "OC" : /(^|\s|\/)codex(\s|$)/i.test(commandText) ? "Codex" : "";
  const terminalTitle = [providerPrefix, shortDescription].filter(Boolean).join(" | ");
  const thinkingSnippet = normalizeDescription(
    agent.thinkingSnippet ||
      agent.currentStep ||
      openCodeMetadata?.thinkingSnippet ||
      extractFlagValue(commandText, ["thinking", "thought", "status", "current-step"])
  );
  const contextWindowUsed = finiteOptionalNumber(agent.contextWindowUsed) ?? openCodeMetadata?.contextWindowUsed ?? null;
  const contextWindowTotal = finiteOptionalNumber(agent.contextWindowTotal) ?? openCodeMetadata?.contextWindowTotal ?? null;

  return {
    shortDescription,
    terminalTitle: terminalTitle || surface?.windowTitle || "",
    currentStep: thinkingSnippet || openCodeMetadata?.currentStep || (processInfo ? "Running locally" : "No matching local process"),
    contextWindowUsed,
    contextWindowTotal,
    contextWindowConfidence: contextWindowUsed !== null || contextWindowTotal !== null ? "reported" : "unknown",
    thinkingSnippet,
    tokens: openCodeMetadata?.tokens || 0,
    tokenCountConfidence: openCodeMetadata?.tokens ? "reported" : "unknown",
    costUsd: openCodeMetadata?.costUsd || 0
  };
}

export function signalPidsForProcessTree(rootPid, processes) {
  return [...descendantProcesses(processes, rootPid).map((item) => item.pid).reverse(), rootPid];
}

function descendantProcesses(processes, rootPid) {
  const childrenByParent = new Map();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) || [];
    children.push(processInfo);
    childrenByParent.set(processInfo.ppid, children);
  }

  const descendants = [];
  const pending = [...(childrenByParent.get(rootPid) || [])];
  while (pending.length) {
    const processInfo = pending.shift();
    descendants.push(processInfo);
    pending.push(...(childrenByParent.get(processInfo.pid) || []));
  }

  return descendants;
}

function roundCpu(value) {
  return Number(Number(value || 0).toFixed(1));
}

async function goToAgent(agent, processes) {
  if (process.platform !== "darwin") return;

  const processInfo = agent.pid
    ? processes.find((item) => item.pid === agent.pid)
    : findMatchingProcess(agent, processes);
  const surface = inferLocalSurface(agent, processInfo, processes);

  if (surface.applicationName) {
    await run("osascript", ["-e", `tell application "${surface.applicationName}" to activate`]);
    return;
  }

  await run("osascript", [
    "-e",
    `tell application "System Events"
      if exists process "Ghostty" then
        tell application "Ghostty" to activate
      else if exists process "iTerm2" then
        tell application "iTerm2" to activate
      else
        tell application "Terminal" to activate
      end if
    end tell`
  ]);
}

export function inferLocalSurface(agent = {}, processInfo = null, processes = []) {
  const commandChain = [
    processInfo,
    ...ancestorProcesses(processes, processInfo?.ppid)
  ]
    .map((item) => item?.command || "")
    .filter(Boolean);
  const commandText = [agent.command, ...commandChain].filter(Boolean).join("\n");
  const applicationName = inferApplicationName(commandText);
  const browserUrl = extractCommandUrl(commandText);
  const pid = processInfo?.pid || agent.pid || null;

  if (browserUrl && applicationName && surfaceKindForApplication(applicationName) === "browser") {
    return {
      goToKind: "url",
      goToTarget: browserUrl,
      windowTitle: `${applicationName} ${new URL(browserUrl).hostname}`,
      applicationName
    };
  }

  if (applicationName) {
    return {
      goToKind: surfaceKindForApplication(applicationName),
      goToTarget: pid ? `pid:${pid}` : "",
      windowTitle: applicationName,
      applicationName
    };
  }

  return {
    goToKind: pid ? "process" : "unknown",
    goToTarget: pid ? `pid:${pid}` : "",
    windowTitle: pid ? `Process ${pid}` : "Local process",
    applicationName: ""
  };
}

function ancestorProcesses(processes, parentPid) {
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const ancestors = [];
  const seen = new Set();
  let pid = parentPid;

  while (pid && byPid.has(pid) && !seen.has(pid)) {
    seen.add(pid);
    const processInfo = byPid.get(pid);
    ancestors.push(processInfo);
    pid = processInfo.ppid;
  }

  return ancestors;
}

function inferApplicationName(command) {
  if (/Google Chrome/i.test(command)) return "Google Chrome";
  if (/Chromium/i.test(command)) return "Chromium";
  if (/Safari/i.test(command)) return "Safari";
  if (/Cursor/i.test(command)) return "Cursor";
  if (/Visual Studio Code|\/Code\.app/i.test(command)) return "Visual Studio Code";
  if (/Ghostty|ghostty/i.test(command)) return "Ghostty";
  if (/iTerm2|iTerm\.app/i.test(command)) return "iTerm2";
  if (/Terminal\.app|\/Terminal\s|login\s+-fp|\/bin\/zsh|\/bin\/bash/i.test(command)) return "Terminal";
  return "";
}

function surfaceKindForApplication(applicationName) {
  if (["Google Chrome", "Chromium", "Safari"].includes(applicationName)) return "browser";
  if (["Terminal", "iTerm2", "Ghostty"].includes(applicationName)) return "terminal";
  return "process";
}

function extractCommandUrl(command) {
  const match = String(command || "").match(/https?:\/\/[^\s"'<>\\)]+/i);
  if (!match) return "";
  try {
    return new URL(match[0]).href;
  } catch {
    return "";
  }
}

function extractFlagValue(command, names) {
  const text = String(command || "");
  for (const name of names) {
    const pattern = new RegExp(`(?:^|\\s)--${name}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|([^\\n]+?))(?=\\s--|\\s-[a-zA-Z]|$)`, "i");
    const match = text.match(pattern);
    if (match) return match[1] || match[2] || match[3] || "";
  }
  return "";
}

function extractCodexExecDescription(command) {
  const text = String(command || "");
  const match = text.match(/(?:^|\s)(?:codex|opencode|claude)\s+(?:exec\s+)?(?:"([^"]+)"|'([^']+)'|([^-\n][^\n]{12,160}))$/i);
  return match ? match[1] || match[2] || match[3] || "" : "";
}

function friendlyCommandDescription(agent, processInfo) {
  if (agent.description || agent.shortDescription) return agent.description || agent.shortDescription;
  if (agent.name && agent.discovered) return agent.name.replace(/\s*\(\d+\)\s*$/, "");
  if (agent.name && agent.command && agent.name !== agent.command) return agent.name;
  const command = String(processInfo?.command || agent.command || "").trim();
  if (!command) return "";
  const executable = command.split(/\s+/)[0].split("/").pop();
  return executable || command;
}

function normalizeDescription(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^exec\s+/i, "")
    .trim()
    .slice(0, 140);
}

function finiteOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function readOpenCodeSessionMetadata() {
  if (!existsSync(openCodeDbPath)) return null;

  const sessions = readOpenCodeRows(
    `select id,title,directory,agent,model,tokens_input,tokens_output,tokens_reasoning,tokens_cache_read,tokens_cache_write,cost,time_created,time_updated from session order by time_updated desc limit 1`
  );
  const session = sessions[0];
  if (!session?.id) return null;

  const parts = readOpenCodeRows(
    `select data,time_updated from part where session_id=${sqliteString(session.id)} order by time_updated desc limit 80`
  )
    .map((row) => ({ ...row, parsed: parseJson(row.data) }))
    .filter((row) => row.parsed);
  const todos = readOpenCodeRows(
    `select content,status,priority,time_updated from todo where session_id=${sqliteString(session.id)} order by position asc`
  );

  const latestTokenPart = parts.find((row) => row.parsed?.tokens?.total);
  const latestReasoning = parts.find((row) => row.parsed?.type === "reasoning" && row.parsed.text);
  const latestTool = parts.find((row) => row.parsed?.type === "tool" && (row.parsed.state?.input?.description || row.parsed.state?.title));
  const activeTodo = todos.find((todo) => !["completed", "cancelled", "failed"].includes(String(todo.status || "").toLowerCase()));
  const currentStep = normalizeDescription(activeTodo?.content || latestTool?.parsed?.state?.input?.description || latestTool?.parsed?.state?.title || "");
  const thinkingSnippet = normalizeDescription(latestReasoning?.parsed?.text || currentStep);
  const tokens = [
    session.tokens_input,
    session.tokens_output,
    session.tokens_reasoning,
    session.tokens_cache_read,
    session.tokens_cache_write
  ].reduce((total, value) => total + Number(value || 0), 0);

  return {
    title: normalizeDescription(session.title),
    currentStep,
    thinkingSnippet,
    contextWindowUsed: finiteOptionalNumber(latestTokenPart?.parsed?.tokens?.total),
    contextWindowTotal: null,
    tokens,
    costUsd: Number(session.cost || 0)
  };
}

function readOpenCodeRows(sql) {
  try {
    const output = execFileSync("sqlite3", ["-json", openCodeDbPath, sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000
    });
    return JSON.parse(output || "[]");
  } catch {
    return [];
  }
}

function sqliteString(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildProcessLogs(agent, processInfo, childPids, isRunning) {
  const logs = [];
  const at = processInfo?.startedAt || Date.now();

  if (processInfo) {
    logs.push({
      at,
      level: "info",
      source: "process",
      message: `Observed PID ${processInfo.pid} with PPID ${processInfo.ppid}.`
    });
  }

  if (childPids.length) {
    logs.push({
      at: Date.now(),
      level: "info",
      source: "process",
      message: `Detected child process${childPids.length === 1 ? "" : "es"} ${childPids.join(", ")}.`
    });
  }

  if (agent.cwd) {
    logs.push({
      at,
      level: "info",
      source: "process",
      message: `Working directory ${agent.cwd}.`
    });
  }

  if (!isRunning) {
    logs.push({
      at: Date.now(),
      level: "warn",
      source: "process",
      message: "No matching local process is currently running."
    });
  }

  return logs;
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
      if (hasMatchingAncestor(processInfo, processes, matcher.pattern)) return null;
      if (isKnownHelperProcess(processInfo.command)) return null;

      return {
        id: `local-discovered-${matcher.id}-${processInfo.pid}`,
        name: `${discoveredAgentName(matcher, processInfo)} (${processInfo.pid})`,
        command: processInfo.command,
        match: processInfo.command,
        discovered: true,
        pid: processInfo.pid
      };
    })
    .filter(Boolean);
}

function hasMatchingAncestor(processInfo, processes, pattern) {
  return ancestorProcesses(processes, processInfo.ppid).some((ancestor) => pattern.test(ancestor.command));
}

function isKnownHelperProcess(command) {
  const text = String(command || "");
  if (!/\/Applications\/Codex\.app\//i.test(text)) return false;
  if (/\/Contents\/MacOS\/Codex$/i.test(text)) return false;
  if (/\/Contents\/Resources\/codex\b/i.test(text)) return false;
  return /browser_crashpad_handler|Codex \(Service\)|Codex \(Renderer\)|bare-modifier-monitor|SkyComputerUseService|--type=/i.test(text);
}

function discoveredAgentName(matcher, processInfo) {
  if (matcher.id === "codex" && /\/Applications\/Codex\.app\/Contents\/MacOS\/Codex$/i.test(processInfo.command)) {
    return "Codex Desktop";
  }
  return matcher.name;
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
