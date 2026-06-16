import {
  formatTokenRate,
  formatMemory,
  formatRuntime,
  agentActions,
  statusTone
} from "./core.js";
import { createAgentClient } from "./client.js";
import styles from "./widgetStyles.js";

const client = createAgentClient();

class AgentMonitorWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    this.unsubscribe = client.subscribe((snapshot) => {
      this.agents = snapshot.agents;
      this.history = snapshot.history;
      this.render();
    });
    const refreshMs = Number(this.getAttribute("refresh-ms") || 0);
    if (refreshMs > 0) {
      this.refreshTimer = window.setInterval(() => client.refresh(), Math.max(refreshMs, 5000));
    }
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
  }

  render() {
    const agents = this.agents || [];
    const running = agents.filter((agent) => agent.status === "running").length;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <section class="widget">
        <header>
          <div>
            <p>Agent Monitor</p>
            <h2>${running} running</h2>
          </div>
          <span>${agents.length} total</span>
        </header>
        <div class="list">
          ${agents.map(renderWidgetAgent).join("")}
        </div>
        ${renderWidgetHistory(this.history || [])}
      </section>
    `;

    this.shadowRoot.querySelectorAll("[data-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const agentId = button.getAttribute("data-agent-id");
        const actionId = button.getAttribute("data-action");
        const action = agentActions.find((item) => item.id === actionId);
        const prompt = action?.requiresPrompt ? window.prompt(`${action.label} prompt`) || "" : "";
        void client.perform(agentId, actionId, prompt);
      });
    });
  }
}

function renderWidgetHistory(history) {
  if (!history.length) return "";

  const latest = history[0];
  return `
    <footer>
      <strong>${latest.label}</strong>
      <span>${latest.agentName}</span>
    </footer>
  `;
}

function renderWidgetAgent(agent) {
  return `
    <article>
      <div class="agent-line">
        <div>
          <strong>${agent.name}</strong>
          <p>${agent.provider} · ${formatRuntime(agent)}</p>
          <p>${lineageSummary(agent)}</p>
        </div>
        <span class="${statusTone(agent.status)}">${agent.status}</span>
      </div>
      <p class="metrics">${renderResourceLine(agent)}</p>
      ${renderLatestLog(agent)}
      <div class="actions">
        ${agentActions.map((action) => renderAction(agent, action)).join("")}
      </div>
    </article>
  `;
}

function lineageSummary(agent) {
  const childCount = agent.children.length;
  const parent = agent.parentId ? `Parent ${agent.parentId}` : "Root";
  return `${parent} · ${childCount} child${childCount === 1 ? "" : "ren"}`;
}

function renderResourceLine(agent) {
  const parts = [`${agent.cpu}% CPU`, formatMemory(agent.memoryMb)];
  if (agent.pid) parts.push(`PID ${agent.pid}`);
  if (agent.parentPid) parts.push(`PPID ${agent.parentPid}`);
  if (agent.childPids?.length) parts.push(`${agent.childPids.length} child PID${agent.childPids.length === 1 ? "" : "s"}`);
  if (agent.tokens) parts.push(`${agent.tokens.toLocaleString()} tokens`);
  const rate = formatTokenRate(agent);
  if (rate) parts.push(rate);
  if (agent.tokenCountConfidence && agent.tokenCountConfidence !== "reported") {
    parts.push(`${agent.tokenCountConfidence} tokens`);
  }
  return parts.join(" · ");
}

function renderLatestLog(agent) {
  const log = Array.isArray(agent.logs) ? agent.logs[0] : null;
  if (!log) return "";
  return `<p class="log-preview">${log.source || "agent"} · ${log.message}</p>`;
}

function renderAction(agent, action) {
  const disabled =
    (action.surface && !agent.capabilities?.includes(action.id)) ||
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

customElements.define("agent-monitor-widget", AgentMonitorWidget);
