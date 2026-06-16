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
      this.selectedAgentId = this.selectedAgentId || snapshot.agents[0]?.id || null;
      this.render();
    });
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  render() {
    const agents = this.agents || [];
    const filters = this.filters || { query: "", status: "all", source: "all" };
    const filteredAgents = filterAgents(agents, filters);
    const running = agents.filter((agent) => agent.status === "running").length;
    const memory = agents.reduce((total, agent) => total + agent.memoryMb, 0);
    const spend = agents.reduce((total, agent) => total + agent.costUsd, 0);
    const history = this.history || [];
    const selectedDetail = this.detail || buildDetail(this.selectedAgentId, agents, history);
    const sources = [...new Set(agents.map((agent) => agent.source))].sort();

    this.innerHTML = `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Local-first control plane</p>
            <h1>Agent Monitor</h1>
          </div>
          <div class="summary-grid" aria-label="Agent summary">
            <article>
              <span>${filteredAgents.length}/${agents.length}</span>
              <p>Visible</p>
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
            ${renderLineageTree(agents)}
            ${renderHistory(history, this.mode)}
          </aside>
          <section class="panel agent-panel">
            <div class="panel-heading">
              <h2>Agent Tasks</h2>
              <button class="icon-button" type="button" title="Refresh snapshots" data-refresh>↻</button>
            </div>
            ${renderFilters(filters, sources)}
            <div class="agent-table" role="table" aria-label="Agent task table">
              ${renderAgentTable(filteredAgents, agents, this.selectedAgentId)}
            </div>
            ${renderDetailPanel(selectedDetail)}
          </section>
        </section>
      </main>
    `;

    this.querySelector("[data-refresh]")?.addEventListener("click", () => client.refresh());
    this.querySelector(".filter-bar")?.addEventListener("submit", (event) => event.preventDefault());
    this.querySelectorAll("[data-filter]").forEach((input) => {
      input.addEventListener("input", () => {
        this.filters = {
          query: this.querySelector('[data-filter="query"]').value,
          status: this.querySelector('[data-filter="status"]').value,
          source: this.querySelector('[data-filter="source"]').value
        };
        this.render();
      });
    });
    this.querySelectorAll("[data-select-agent]").forEach((button) => {
      button.addEventListener("click", async () => {
        this.selectedAgentId = button.getAttribute("data-select-agent");
        this.detail = buildDetail(this.selectedAgentId, this.agents || [], this.history || []);
        this.render();
        this.detail = await client.detail(this.selectedAgentId);
        this.render();
      });
    });
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

function renderFilters(filters, sources) {
  return `
    <form class="filter-bar" aria-label="Agent filters">
      <label>
        <span>Search</span>
        <input data-filter="query" type="search" value="${escapeAttribute(filters.query)}" placeholder="Name, task, provider" />
      </label>
      <label>
        <span>Status</span>
        <select data-filter="status">
          ${["all", "running", "paused", "waiting", "ended"].map((status) => renderOption(status, filters.status)).join("")}
        </select>
      </label>
      <label>
        <span>Source</span>
        <select data-filter="source">
          ${["all", ...sources].map((source) => renderOption(source, filters.source, source === "all" ? "All" : labelize(source))).join("")}
        </select>
      </label>
    </form>
  `;
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

function renderAgentTable(agents, allAgents, selectedAgentId) {
  if (!agents.length) {
    return `
      <div class="table-row table-head" role="row">
        <span>Agent</span>
        <span>Status</span>
        <span>Resources</span>
        <span>Lineage</span>
        <span>Actions</span>
      </div>
      <article class="empty-row">No agents match the current filters.</article>
    `;
  }

  return `
    <div class="table-row table-head" role="row">
      <span>Agent</span>
      <span>Status</span>
      <span>Resources</span>
      <span>Lineage</span>
      <span>Actions</span>
    </div>
    ${agents.map((agent) => renderAgentRow(agent, allAgents, selectedAgentId)).join("")}
  `;
}

function renderAgentRow(agent, agents, selectedAgentId) {
  const parent = agent.parentId ? agents.find((item) => item.id === agent.parentId)?.name || agent.parentId : "Root";
  const childCount = agent.children.length;
  const childNames = agent.children
    .map((childId) => agents.find((item) => item.id === childId)?.name || childId)
    .join(", ");
  return `
    <article class="table-row ${agent.id === selectedAgentId ? "selected" : ""}" role="row">
      <div class="agent-name">
        <button class="agent-link" type="button" data-select-agent="${agent.id}">${agent.name}</button>
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
        <p class="muted">${childCount ? childNames : "No children"}</p>
      </div>
      <div class="action-row">
        ${lifecycleActions.map((action) => renderAction(agent, action)).join("")}
      </div>
    </article>
  `;
}

function renderDetailPanel(detail) {
  if (!detail?.agent) return "";

  const { agent, parent, children, history } = detail;
  return `
    <section class="detail-panel">
      <div class="detail-heading">
        <div>
          <p class="eyebrow">Selected Agent</p>
          <h2>${agent.name}</h2>
        </div>
        <span class="status-pill ${statusTone(agent.status)}">${agent.status}</span>
      </div>
      <div class="detail-grid">
        <article>
          <span>Provider</span>
          <strong>${agent.provider}</strong>
          <p>${agent.providerId || agent.source || "unknown"}</p>
        </article>
        <article>
          <span>Runtime</span>
          <strong>${formatRuntime(agent)}</strong>
          <p>${formatTimestamp(agent.startedAt)}</p>
        </article>
        <article>
          <span>Resources</span>
          <strong>${formatMemory(agent.memoryMb)}</strong>
          <p>${renderProcessLine(agent)}</p>
        </article>
        <article>
          <span>Usage</span>
          <strong>${agent.tokens ? agent.tokens.toLocaleString() : 0} tokens</strong>
          <p>$${Number(agent.costUsd || 0).toFixed(2)}</p>
        </article>
      </div>
      <div class="detail-columns">
        <article>
          <h3>Lineage</h3>
          <p><strong>Parent:</strong> ${parent?.name || "Root"}</p>
          <p><strong>Children:</strong> ${children.length ? children.map((child) => child.name).join(", ") : "None"}</p>
        </article>
        <article>
          <h3>Recent Actions</h3>
          ${history.length ? history.slice(0, 4).map(renderDetailHistory).join("") : "<p>No actions recorded.</p>"}
        </article>
        <article>
          <h3>Logs</h3>
          ${renderAgentLogs(agent)}
        </article>
      </div>
    </section>
  `;
}

function renderAgentLogs(agent) {
  const logs = Array.isArray(agent.logs) ? agent.logs : [];
  if (!logs.length) return "<p>No logs reported.</p>";

  return logs
    .slice(0, 5)
    .map(
      (log) => `
        <p class="log-line ${log.level || "info"}">
          <strong>${log.source || "agent"}</strong>
          <span>${formatTimestamp(log.at)} · ${log.message}</span>
        </p>
      `
    )
    .join("");
}

function renderDetailHistory(record) {
  return `
    <p>
      <strong>${record.label}</strong>
      <span>${formatTimestamp(record.at)}${record.prompt ? ` · ${record.prompt}` : ""}</span>
    </p>
  `;
}

function buildDetail(agentId, agents, history) {
  const agent = agents.find((item) => item.id === agentId);
  if (!agent) return null;

  return {
    agent,
    parent: agent.parentId ? agents.find((item) => item.id === agent.parentId) || null : null,
    children: agent.children
      .map((childId) => agents.find((item) => item.id === childId))
      .filter(Boolean),
    history: history.filter((record) => record.agentId === agentId)
  };
}

function renderLineageTree(agents) {
  const roots = agents.filter((agent) => !agent.parentId || !agents.some((item) => item.id === agent.parentId));

  return `
    <section class="lineage-block">
      <h2>Lineage</h2>
      <div class="lineage-tree">
        ${roots.map((agent) => renderLineageNode(agent, agents, 0)).join("")}
      </div>
    </section>
  `;
}

function renderLineageNode(agent, agents, depth) {
  const children = agent.children
    .map((childId) => agents.find((item) => item.id === childId))
    .filter(Boolean);

  return `
    <article class="lineage-node" style="--depth: ${depth}">
      <div>
        <strong>${agent.name}</strong>
        <p>${agent.provider} · ${agent.status}</p>
      </div>
      <span>${children.length}</span>
    </article>
    ${children.map((child) => renderLineageNode(child, agents, depth + 1)).join("")}
  `;
}

function renderResourceLine(agent) {
  const parts = [`${agent.cpu}% CPU`, formatMemory(agent.memoryMb)];
  if (agent.pid) parts.push(`PID ${agent.pid}`);
  if (agent.parentPid) parts.push(`PPID ${agent.parentPid}`);
  if (agent.childPids?.length) parts.push(`${agent.childPids.length} child PID${agent.childPids.length === 1 ? "" : "s"}`);
  if (agent.tokens) parts.push(`${agent.tokens.toLocaleString()} tokens`);
  return parts.join(" · ");
}

function renderProcessLine(agent) {
  const parts = [`${agent.cpu}% CPU`];
  if (agent.pid) parts.push(`PID ${agent.pid}`);
  if (agent.parentPid) parts.push(`PPID ${agent.parentPid}`);
  if (agent.childPids?.length) parts.push(`children ${agent.childPids.join(", ")}`);
  return parts.join(" · ");
}

function filterAgents(agents, filters) {
  const query = filters.query.trim().toLowerCase();

  return agents.filter((agent) => {
    const matchesQuery =
      !query ||
      [agent.name, agent.provider, agent.task, agent.id, agent.providerId, agent.source]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    const matchesStatus = filters.status === "all" || agent.status === filters.status;
    const matchesSource = filters.source === "all" || agent.source === filters.source;
    return matchesQuery && matchesStatus && matchesSource;
  });
}

function renderOption(value, selected, label = labelize(value)) {
  return `<option value="${escapeAttribute(value)}" ${value === selected ? "selected" : ""}>${label}</option>`;
}

function escapeAttribute(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function renderAction(agent, action) {
  const disabled =
    (agent.capabilities && !agent.capabilities.includes(action.id)) ||
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
