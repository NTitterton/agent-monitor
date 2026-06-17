export const lifecycleActions = [
  { id: "start", label: "Start", nextStatus: "running", requiresPrompt: false },
  { id: "stop", label: "Stop", nextStatus: "paused", requiresPrompt: false },
  { id: "interrupt", label: "Interrupt", nextStatus: "waiting", requiresPrompt: true },
  { id: "end", label: "End", nextStatus: "ended", requiresPrompt: true },
  { id: "force-end", label: "Force End", nextStatus: "ended", requiresPrompt: false, destructive: true }
];

export const surfaceActions = [
  { id: "go-to", label: "Go To", requiresPrompt: false, surface: true }
];

export const agentActions = [...lifecycleActions, ...surfaceActions];

const terminalStatuses = new Set([
  "ended",
  "completed",
  "complete",
  "succeeded",
  "done",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "expired"
]);

export function isTerminalStatus(status) {
  return terminalStatuses.has(String(status || "").toLowerCase());
}

export function createAgentStore(seedAgents = []) {
  let agents = seedAgents.map(cloneAgent);
  const subscribers = new Set();

  function emit() {
    const snapshot = agents.map(cloneAgent);
    subscribers.forEach((subscriber) => subscriber(snapshot));
  }

  return {
    list() {
      return agents.map(cloneAgent);
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      subscriber(this.list());
      return () => subscribers.delete(subscriber);
    },
    perform(agentId, actionId, prompt = "") {
      agents = agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        return applyLifecycleAction(agent, actionId, prompt);
      });

      emit();
    }
  };
}

function cloneAgent(agent) {
  return {
    ...agent,
    children: Array.isArray(agent.children) ? [...agent.children] : [],
    childPids: Array.isArray(agent.childPids) ? [...agent.childPids] : [],
    logs: Array.isArray(agent.logs) ? agent.logs.map((log) => ({ ...log })) : [],
    transcript: Array.isArray(agent.transcript) ? agent.transcript.map((entry) => ({ ...entry })) : []
  };
}

export function applyLifecycleAction(agent, actionId, prompt = "", at = Date.now()) {
  const action = lifecycleActions.find((item) => item.id === actionId);
  if (!action) return agent;
  const record = createActionRecord(agent, actionId, prompt, at);

  const changed = {
    ...agent,
    status: action.nextStatus,
    lastAction: record,
    logs: [
      createLogRecord({
        at,
        level: action.destructive ? "error" : "info",
        source: "operator",
        message: `${action.label}${prompt.trim() ? `: ${prompt.trim()}` : ""}`
      }),
      ...(Array.isArray(agent.logs) ? agent.logs : [])
    ].slice(0, 50)
  };

  if (action.nextStatus === "running" && !changed.startedAt) {
    changed.startedAt = at;
  }

  if (action.nextStatus === "ended") {
    changed.cpu = 0;
    changed.memoryMb = 0;
    changed.tokensPerSecond = 0;
    changed.endedAt = at;
  }

  return changed;
}

export function createLogRecord({ at = Date.now(), level = "info", source = "agent", message = "" }) {
  return {
    at,
    level,
    source,
    message: String(message || "").trim()
  };
}

export function createActionRecord(agent, actionId, prompt = "", at = Date.now()) {
  const action = agentActions.find((item) => item.id === actionId);
  if (!action) return null;

  return {
    id: `${agent.id}-${action.id}-${at}`,
    agentId: agent.id,
    agentName: agent.name,
    provider: agent.provider || "",
    providerId: agent.providerId || "",
    source: agent.source || "",
    type: agent.type || "",
    action: action.id,
    actionKind: action.surface ? "surface" : "lifecycle",
    label: action.label,
    prompt: prompt.trim(),
    at
  };
}

export function formatRuntime(agent) {
  const startedAt = Number(agent?.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return "Unknown runtime";
  const endedAt = Number(agent?.endedAt);
  const end = Number.isFinite(endedAt) && endedAt > 0 ? endedAt : Date.now();
  const totalMinutes = Math.max(1, Math.round((end - startedAt) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatMemory(memoryMb) {
  return memoryMb >= 1024 ? `${(memoryMb / 1024).toFixed(1)} GB` : `${memoryMb} MB`;
}

export function formatTokenRate(agent) {
  const rate = Number(agent?.tokensPerSecond || 0);
  if (!Number.isFinite(rate) || rate <= 0) return "";
  return `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)} tok/s`;
}

export function statusTone(status) {
  return {
    running: "good",
    paused: "idle",
    waiting: "warn",
    ended: "done"
  }[status] || "idle";
}
