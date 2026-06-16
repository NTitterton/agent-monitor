const now = Date.now();

export const initialAgents = [
  {
    id: "local-codex-1",
    name: "Codex implementation run",
    provider: "Local Codex",
    source: "local",
    status: "running",
    parentId: null,
    task: "Scaffold browser task manager",
    cpu: 38,
    memoryMb: 812,
    tokens: 18420,
    costUsd: 0.42,
    startedAt: now - 1000 * 60 * 42,
    children: ["openai-research-2"]
  },
  {
    id: "openai-research-2",
    name: "OpenAI docs researcher",
    provider: "OpenAI",
    source: "cloud",
    status: "paused",
    parentId: "local-codex-1",
    task: "Map Assistants and Responses integration options",
    cpu: 4,
    memoryMb: 128,
    tokens: 9150,
    costUsd: 0.18,
    startedAt: now - 1000 * 60 * 33,
    children: []
  },
  {
    id: "anthropic-review-1",
    name: "Architecture reviewer",
    provider: "Anthropic",
    source: "user-account",
    status: "waiting",
    parentId: null,
    task: "Review lifecycle semantics",
    cpu: 0,
    memoryMb: 96,
    tokens: 4620,
    costUsd: 0.13,
    startedAt: now - 1000 * 60 * 19,
    children: []
  },
  {
    id: "remote-build-7",
    name: "Remote integration smoke test",
    provider: "Remote Runner",
    source: "cloud",
    status: "ended",
    parentId: null,
    task: "Validate widget bundle on personal site",
    cpu: 0,
    memoryMb: 0,
    tokens: 1280,
    costUsd: 0.04,
    startedAt: now - 1000 * 60 * 74,
    endedAt: now - 1000 * 60 * 11,
    children: []
  }
];

export const lifecycleActions = [
  { id: "start", label: "Start", nextStatus: "running", requiresPrompt: false },
  { id: "stop", label: "Stop", nextStatus: "paused", requiresPrompt: false },
  { id: "interrupt", label: "Interrupt", nextStatus: "waiting", requiresPrompt: true },
  { id: "end", label: "End", nextStatus: "ended", requiresPrompt: true },
  { id: "force-end", label: "Force End", nextStatus: "ended", requiresPrompt: false, destructive: true }
];

export function createAgentStore(seedAgents = initialAgents) {
  let agents = seedAgents.map((agent) => ({ ...agent, children: [...agent.children] }));
  const subscribers = new Set();

  function emit() {
    const snapshot = agents.map((agent) => ({ ...agent, children: [...agent.children] }));
    subscribers.forEach((subscriber) => subscriber(snapshot));
  }

  return {
    list() {
      return agents.map((agent) => ({ ...agent, children: [...agent.children] }));
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

export function applyLifecycleAction(agent, actionId, prompt = "", at = Date.now()) {
  const action = lifecycleActions.find((item) => item.id === actionId);
  if (!action) return agent;

  const changed = {
    ...agent,
    status: action.nextStatus,
    lastAction: createActionRecord(agent, actionId, prompt, at)
  };

  if (action.nextStatus === "running" && !changed.startedAt) {
    changed.startedAt = at;
  }

  if (action.nextStatus === "ended") {
    changed.cpu = 0;
    changed.memoryMb = 0;
    changed.endedAt = at;
  }

  return changed;
}

export function createActionRecord(agent, actionId, prompt = "", at = Date.now()) {
  const action = lifecycleActions.find((item) => item.id === actionId);
  if (!action) return null;

  return {
    id: `${agent.id}-${action.id}-${at}`,
    agentId: agent.id,
    agentName: agent.name,
    action: action.id,
    label: action.label,
    prompt: prompt.trim(),
    at
  };
}

export function formatRuntime(agent) {
  const end = agent.endedAt || Date.now();
  const totalMinutes = Math.max(1, Math.round((end - agent.startedAt) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatMemory(memoryMb) {
  return memoryMb >= 1024 ? `${(memoryMb / 1024).toFixed(1)} GB` : `${memoryMb} MB`;
}

export function statusTone(status) {
  return {
    running: "good",
    paused: "idle",
    waiting: "warn",
    ended: "done"
  }[status] || "idle";
}
