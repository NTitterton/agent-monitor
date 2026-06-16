const fallbackAgents = [
  {
    id: "local-codex-1",
    name: "Codex implementation run",
    provider: "Local Codex",
    status: "running",
    task: "Scaffold browser task manager",
    cpu: 38,
    memoryMb: 812,
    tokens: 18420,
    startedAt: Date.now() - 1000 * 60 * 42,
    children: ["openai-research-2"]
  },
  {
    id: "openai-research-2",
    name: "OpenAI docs researcher",
    provider: "OpenAI",
    status: "paused",
    task: "Map integration options",
    cpu: 4,
    memoryMb: 128,
    tokens: 9150,
    startedAt: Date.now() - 1000 * 60 * 33,
    children: []
  }
];

const actions = [
  { id: "start", label: "Start", prompt: false },
  { id: "stop", label: "Stop", prompt: false },
  { id: "interrupt", label: "Interrupt", prompt: true },
  { id: "end", label: "End", prompt: true },
  { id: "force-end", label: "Force End", prompt: false, danger: true }
];

const styles = `
  :host {
    display: block;
    color: #172033;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .widget {
    background: #ffffff;
    border: 1px solid #d7dce5;
    border-radius: 8px;
    box-shadow: 0 18px 45px rgba(25, 34, 51, 0.12);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 20px;
    background: #172033;
    color: #ffffff;
  }

  header p,
  header h2,
  article p {
    margin: 0;
  }

  header p {
    color: #b8c2d4;
    font-size: 0.78rem;
    text-transform: uppercase;
  }

  header h2 {
    margin-top: 4px;
    font-size: 1.3rem;
  }

  header span {
    color: #dce3ee;
    font-size: 0.9rem;
  }

  article {
    padding: 16px 20px;
    border-top: 1px solid #e6e9ef;
  }

  .agent-line {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  strong {
    font-size: 0.96rem;
  }

  article p,
  footer span {
    color: #5d687a;
    font-size: 0.82rem;
  }

  .metrics {
    margin-top: 10px;
  }

  .status {
    border-radius: 999px;
    padding: 4px 8px;
    font-size: 0.75rem;
    text-transform: capitalize;
    white-space: nowrap;
  }

  .good {
    background: #dff8ea;
    color: #126735;
  }

  .idle {
    background: #eef1f5;
    color: #536071;
  }

  .warn {
    background: #fff1cc;
    color: #805500;
  }

  .done {
    background: #e6edf7;
    color: #344d75;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }

  button {
    border: 1px solid #cbd2dd;
    border-radius: 6px;
    background: #ffffff;
    color: #172033;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    min-height: 30px;
    padding: 5px 8px;
  }

  button:hover:not(:disabled) {
    background: #f4f7fb;
  }

  button:disabled {
    color: #9aa3af;
    cursor: not-allowed;
  }

  button.danger {
    border-color: #efb6b6;
    color: #a62626;
  }

  footer {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 20px;
    border-top: 1px solid #e6e9ef;
    background: #f7f9fc;
    font-size: 0.8rem;
  }
`;

class StandaloneAgentMonitorWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.agents = fallbackAgents;
    this.history = [];
  }

  connectedCallback() {
    this.render();
    void this.refresh();
    this.refreshTimer = window.setInterval(() => this.refresh(), Number(this.getAttribute("refresh-ms") || 15000));
  }

  disconnectedCallback() {
    window.clearInterval(this.refreshTimer);
  }

  async refresh() {
    const apiBase = this.apiBase();
    if (!apiBase) return;

    try {
      const response = await fetch(`${apiBase}/api/agents`, { headers: this.headers() });
      if (!response.ok) throw new Error(`Agent Monitor returned ${response.status}`);
      const payload = await response.json();
      this.agents = payload.agents || [];
      this.history = payload.history || [];
      this.render();
    } catch {
      this.render();
    }
  }

  async perform(agentId, action) {
    const apiBase = this.apiBase();
    const prompt = action.prompt ? window.prompt(`${action.label} prompt`) || "" : "";

    if (!apiBase) {
      this.applyLocalAction(agentId, action, prompt);
      return;
    }

    try {
      const response = await fetch(`${apiBase}/api/agents/${encodeURIComponent(agentId)}/actions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ action: action.id, prompt })
      });
      if (!response.ok) throw new Error(`Agent Monitor returned ${response.status}`);
      const payload = await response.json();
      this.agents = payload.agents || this.agents;
      this.history = payload.history || this.history;
      this.render();
    } catch {
      this.applyLocalAction(agentId, action, prompt);
    }
  }

  applyLocalAction(agentId, action, prompt) {
    const at = Date.now();
    this.agents = this.agents.map((agent) => {
      if (agent.id !== agentId) return agent;
      return {
        ...agent,
        status: statusForAction(action.id),
        cpu: action.id === "end" || action.id === "force-end" ? 0 : agent.cpu,
        memoryMb: action.id === "end" || action.id === "force-end" ? 0 : agent.memoryMb,
        lastAction: { action: action.id, label: action.label, prompt, at }
      };
    });
    const agent = this.agents.find((item) => item.id === agentId);
    if (agent) {
      this.history = [{ agentName: agent.name, label: action.label, prompt, at }, ...this.history].slice(0, 8);
    }
    this.render();
  }

  render() {
    const running = this.agents.filter((agent) => agent.status === "running").length;
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <section class="widget">
        <header>
          <div>
            <p>Agent Monitor</p>
            <h2>${running} running</h2>
          </div>
          <span>${this.agents.length} total</span>
        </header>
        ${this.agents.map((agent) => this.renderAgent(agent)).join("")}
        ${this.renderFooter()}
      </section>
    `;

    this.shadowRoot.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = actions.find((item) => item.id === button.getAttribute("data-action"));
        if (action) void this.perform(button.getAttribute("data-agent-id"), action);
      });
    });
  }

  renderAgent(agent) {
    return `
      <article>
        <div class="agent-line">
          <div>
            <strong>${escapeHtml(agent.name)}</strong>
            <p>${escapeHtml(agent.provider)} · ${formatRuntime(agent)}</p>
          </div>
          <span class="status ${tone(agent.status)}">${escapeHtml(agent.status)}</span>
        </div>
        <p class="metrics">${formatResourceLine(agent)}</p>
        <div class="actions">
          ${actions.map((action) => renderAction(agent, action)).join("")}
        </div>
      </article>
    `;
  }

  renderFooter() {
    if (!this.history.length) {
      return `<footer><strong>${this.apiBase() ? "Connected" : "Fallback mode"}</strong><span>${this.apiBase() || "No api-base"}</span></footer>`;
    }

    const latest = this.history[0];
    return `<footer><strong>${escapeHtml(latest.label)}</strong><span>${escapeHtml(latest.agentName)}</span></footer>`;
  }

  apiBase() {
    return this.getAttribute("api-base")?.replace(/\/+$/, "") || "";
  }

  apiToken() {
    return this.getAttribute("api-token") || "";
  }

  headers() {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(this.apiToken() ? { "X-Agent-Monitor-Token": this.apiToken() } : {})
    };
  }
}

function renderAction(agent, action) {
  const disabled =
    (agent.status === "ended" && action.id !== "start") ||
    (agent.status === "running" && action.id === "start");
  return `
    <button
      class="${action.danger ? "danger" : ""}"
      type="button"
      data-agent-id="${escapeHtml(agent.id)}"
      data-action="${action.id}"
      ${disabled ? "disabled" : ""}
    >
      ${action.label}
    </button>
  `;
}

function statusForAction(actionId) {
  return {
    start: "running",
    stop: "paused",
    interrupt: "waiting",
    end: "ended",
    "force-end": "ended"
  }[actionId] || "waiting";
}

function tone(status) {
  return {
    running: "good",
    paused: "idle",
    waiting: "warn",
    ended: "done"
  }[status] || "idle";
}

function formatRuntime(agent) {
  const end = agent.endedAt || Date.now();
  const totalMinutes = Math.max(1, Math.round((end - agent.startedAt) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatMemory(memoryMb) {
  return memoryMb >= 1024 ? `${(memoryMb / 1024).toFixed(1)} GB` : `${memoryMb} MB`;
}

function formatResourceLine(agent) {
  const parts = [`${Number(agent.cpu || 0)}% CPU`, formatMemory(Number(agent.memoryMb || 0))];
  if (agent.pid) parts.push(`PID ${agent.pid}`);
  if (agent.tokens) parts.push(`${Number(agent.tokens).toLocaleString()} tokens`);
  return parts.join(" · ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if (!customElements.get("agent-monitor-widget")) {
  customElements.define("agent-monitor-widget", StandaloneAgentMonitorWidget);
}
