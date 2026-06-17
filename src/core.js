const now = Date.now();

export const initialAgents = [
  {
    id: "local-codex-1",
    name: "Codex implementation run",
    provider: "Local Codex",
    type: "local",
    source: "local",
    status: "running",
    parentId: null,
    task: "Scaffold browser task manager",
    cpu: 38,
    memoryMb: 812,
    tokens: 18420,
    tokensPerSecond: 7.3,
    tokenRateWindowMs: 300000,
    tokenCountConfidence: "estimated",
    costUsd: 0.42,
    startedAt: now - 1000 * 60 * 42,
    children: ["openai-research-2"],
    capabilities: ["start", "stop", "interrupt", "end", "force-end"],
    transcript: [
      {
        at: now - 1000 * 60 * 40,
        role: "user",
        source: "operator",
        content: "Build the initial browser task manager shell."
      },
      {
        at: now - 1000 * 60 * 39,
        role: "assistant",
        source: "local",
        content: "Scaffolded the app shell, provider list, and lifecycle controls."
      }
    ],
    logs: [
      {
        at: now - 1000 * 60 * 41,
        level: "info",
        source: "local",
        message: "Started browser task-manager scaffold."
      }
    ]
  },
  {
    id: "openai-research-2",
    name: "OpenAI docs researcher",
    provider: "OpenAI",
    type: "openai",
    source: "cloud",
    status: "paused",
    parentId: "local-codex-1",
    task: "Map Assistants and Responses integration options",
    cpu: 4,
    memoryMb: 128,
    tokens: 9150,
    tokensPerSecond: 4.6,
    tokenRateWindowMs: 300000,
    tokenCountConfidence: "reported",
    costUsd: 0.18,
    startedAt: now - 1000 * 60 * 33,
    children: [],
    capabilities: ["stop", "interrupt", "end", "force-end"],
    transcript: [
      {
        at: now - 1000 * 60 * 30,
        role: "assistant",
        source: "openai",
        content: "Responses API retrieve and cancel endpoints can back account-level tracking."
      }
    ],
    logs: [
      {
        at: now - 1000 * 60 * 31,
        level: "info",
        source: "openai",
        message: "Mapped provider integration options."
      }
    ]
  },
  {
    id: "anthropic-review-1",
    name: "Architecture reviewer",
    provider: "Anthropic",
    type: "anthropic",
    source: "user-account",
    status: "waiting",
    parentId: null,
    task: "Review lifecycle semantics",
    cpu: 0,
    memoryMb: 96,
    tokens: 4620,
    tokensPerSecond: 0,
    tokenRateWindowMs: 0,
    tokenCountConfidence: "estimated",
    costUsd: 0.13,
    startedAt: now - 1000 * 60 * 19,
    children: [],
    capabilities: ["stop", "interrupt", "end", "force-end"],
    transcript: [
      {
        at: now - 1000 * 60 * 17,
        role: "assistant",
        source: "anthropic",
        content: "Batch status can be represented as request-count progress until per-message output is available."
      }
    ],
    logs: [
      {
        at: now - 1000 * 60 * 18,
        level: "warn",
        source: "anthropic",
        message: "Waiting for lifecycle semantics review."
      }
    ]
  },
  {
    id: "remote-build-7",
    name: "Remote integration smoke test",
    provider: "Remote Runner",
    type: "remote",
    source: "cloud",
    status: "ended",
    parentId: null,
    task: "Validate widget bundle on personal site",
    cpu: 0,
    memoryMb: 0,
    tokens: 1280,
    tokensPerSecond: 0,
    tokenRateWindowMs: 0,
    tokenCountConfidence: "reported",
    costUsd: 0.04,
    startedAt: now - 1000 * 60 * 74,
    endedAt: now - 1000 * 60 * 11,
    children: [],
    remoteUrl: "https://agents.example.com",
    goToTarget: "https://agents.example.com",
    goToKind: "url",
    windowTitle: "Remote Runner dashboard",
    capabilities: ["start", "stop", "interrupt", "end", "force-end", "go-to"],
    transcript: [
      {
        at: now - 1000 * 60 * 12,
        role: "assistant",
        source: "remote",
        content: "Validated that the standalone widget can load against the local API."
      }
    ],
    logs: [
      {
        at: now - 1000 * 60 * 11,
        level: "info",
        source: "remote",
        message: "Widget bundle validation completed."
      }
    ]
  }
];

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

export function createAgentStore(seedAgents = initialAgents) {
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
