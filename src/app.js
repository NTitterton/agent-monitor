import {
  formatMemory,
  formatRuntime,
  lifecycleActions,
  statusTone
} from "./core.js";
import { createAgentClient } from "./client.js";

const client = createAgentClient();

class AgentMonitorApp extends HTMLElement {
  connectedCallback() {
    this.unsubscribe = client.subscribe((snapshot) => {
      this.agents = snapshot.agents;
      this.history = snapshot.history;
      this.providers = snapshot.providers;
      this.mode = snapshot.mode;
      this.render();
    });
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render() {
    const agents = this.agents || [];
    const running = agents.filter((agent) => agent.status === "running").length;
    const memory = agents.reduce((total, agent) => total + agent.memoryMb, 0);
    const spend = agents.reduce((total, agent) => total + agent.costUsd, 0);
    const history = this.history || [];

    this.innerHTML = `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Local-first control plane</p>
            <h1>Agent Monitor</h1>
          </div>
          <div class="summary-grid" aria-label="Agent summary">
            <article>
              <span>${agents.length}</span>
              <p>Agents</p>
            </article>
            <article>
              <span>${running}</span>
              <p>Running</p>
            </article>
            <article>
              <span>${formatMemory(memory)}</span>
              <p>Memory</p>
            </article>
            <article>
              <span>$${spend.toFixed(2)}</span>
              <p>Spend</p>
            </article>
          </div>
        </header>

        <section class="workspace">
          <aside class="panel sources-panel">
            <h2>Sources</h2>
            ${renderSourceList(agents, this.providers || [])}
            ${renderHistory(history, this.mode)}
          </aside>
          <section class="panel agent-panel">
            <div class="panel-heading">
              <h2>Agent Tasks</h2>
              <button class="icon-button" type="button" title="Refresh snapshots" data-refresh>↻</button>
            </div>
            <div class="agent-table" role="table" aria-label="Agent task table">
              ${renderAgentTable(agents)}
            </div>
          </section>
        </section>
      </main>
    `;

    this.querySelector("[data-refresh]")?.addEventListener("click", () => client.refresh());
    this.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const agentId = button.getAttribute("data-agent-id");
        const actionId = button.getAttribute("data-action");
        const action = lifecycleActions.find((item) => item.id === actionId);
        let prompt = "";

        if (action?.requiresPrompt) {
          prompt = window.prompt(`${action.label} prompt`) || "";
        }

        void client.perform(agentId, actionId, prompt);
      });
    });
  }
}

function renderHistory(history, mode = "local") {
  if (!history.length) {
    return `
      <section class="history-block">
        <h2>Action History</h2>
        <p class="empty-history">${mode === "api" ? "No actions recorded yet." : "History is stored when the local API is running."}</p>
      </section>
    `;
  }

  return `
    <section class="history-block">
      <h2>Action History</h2>
      ${history
        .slice(0, 8)
        .map(
          (record) => `
            <article class="history-row">
              <strong>${record.label}</strong>
              <p>${record.agentName} · ${formatTimestamp(record.at)}</p>
              ${record.prompt ? `<p class="prompt-text">${record.prompt}</p>` : ""}
            </article>
          `
        )
        .join("")}
    </section>
  `;
}

function renderSourceList(agents, providers) {
  const bySource = agents.reduce((groups, agent) => {
    const sourceAgents = groups.get(agent.source) || [];
    sourceAgents.push(agent);
    groups.set(agent.source, sourceAgents);
    return groups;
  }, new Map());

  const sourceRows = [...bySource.entries()]
    .map(([source, sourceAgents]) => {
      const running = sourceAgents.filter((agent) => agent.status === "running").length;
      return `
        <article class="source-row">
          <div>
            <strong>${labelize(source)}</strong>
            <p>${sourceAgents.length} agents, ${running} running</p>
          </div>
          <span>${sourceAgents.map((agent) => agent.provider).filter(unique).join(", ")}</span>
        </article>
      `;
    })
    .join("");

  const providerRows = providers
    .filter((provider) => provider.status === "error")
    .map(
      (provider) => `
        <article class="source-row source-error">
          <div>
            <strong>${provider.label}</strong>
            <p>${provider.error}</p>
          </div>
          <span>Provider error</span>
        </article>
      `
    )
    .join("");

  return `${sourceRows}${providerRows}`;
}

function renderAgentTable(agents) {
  return `
    <div class="table-row table-head" role="row">
      <span>Agent</span>
      <span>Status</span>
      <span>Resources</span>
      <span>Lineage</span>
      <span>Actions</span>
    </div>
    ${agents.map(renderAgentRow).join("")}
  `;
}

function renderAgentRow(agent) {
  const parent = agent.parentId || "Root";
  const childCount = agent.children.length;
  return `
    <article class="table-row" role="row">
      <div class="agent-name">
        <strong>${agent.name}</strong>
        <p>${agent.provider} · ${agent.task}</p>
      </div>
      <div>
        <span class="status-pill ${statusTone(agent.status)}">${agent.status}</span>
        <p class="muted">${formatRuntime(agent)}</p>
      </div>
      <div class="resource-stack">
        <meter min="0" max="100" value="${agent.cpu}"></meter>
        <p>${renderResourceLine(agent)}</p>
      </div>
      <div>
        <p>${parent}</p>
        <p class="muted">${childCount} child${childCount === 1 ? "" : "ren"}</p>
      </div>
      <div class="action-row">
        ${lifecycleActions.map((action) => renderAction(agent, action)).join("")}
      </div>
    </article>
  `;
}

function renderResourceLine(agent) {
  const parts = [`${agent.cpu}% CPU`, formatMemory(agent.memoryMb)];
  if (agent.pid) parts.push(`PID ${agent.pid}`);
  if (agent.tokens) parts.push(`${agent.tokens.toLocaleString()} tokens`);
  return parts.join(" · ");
}

function renderAction(agent, action) {
  const disabled =
    (agent.status === "ended" && action.id !== "start") ||
    (agent.status === "running" && action.id === "start");
  return `
    <button
      class="${action.destructive ? "danger" : ""}"
      type="button"
      data-agent-id="${agent.id}"
      data-action="${action.id}"
      ${disabled ? "disabled" : ""}
    >
      ${action.label}
    </button>
  `;
}

function labelize(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unique(value, index, values) {
  return values.indexOf(value) === index;
}

function formatTimestamp(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

customElements.define("agent-monitor-app", AgentMonitorApp);
