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
      this.actionMessage = snapshot.actionMessage;
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
        ${renderActionMessage(this.actionMessage)}
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
      <strong>${escapeText(latest.label)}</strong>
      <span>${escapeText(latest.agentName)}</span>
    </footer>
  `;
}

function renderActionMessage(message) {
  if (!message) return "";

  return `
    <p class="action-message ${escapeAttribute(message.tone || "ok")}">
      ${escapeText(message.text || "")}
    </p>
  `;
}

function renderWidgetAgent(agent) {
  return `
    <article>
      <div class="agent-line">
        <div>
          <strong>${escapeText(agent.name)}</strong>
          <p>${escapeText(agent.provider)} · ${formatRuntime(agent)}</p>
          <p>${escapeText(lineageSummary(agent))}</p>
        </div>
        <span class="${escapeAttribute(statusTone(agent.status))}">${escapeText(agent.status)}</span>
      </div>
      <p class="metrics">${escapeText(renderResourceLine(agent))}</p>
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
  if (agent.childCpu || agent.childMemoryMb) {
    parts.push(`children ${Number(agent.childCpu || 0)}% / ${formatMemory(Number(agent.childMemoryMb || 0))}`);
  }
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
  return `<p class="log-preview">${escapeText(log.source || "agent")} · ${escapeText(log.message)}</p>`;
}

function renderAction(agent, action) {
  const disabledReason = actionDisabledReason(agent, action);
  return `
    <button
      class="${action.destructive ? "danger" : ""}"
      type="button"
      data-agent-id="${escapeAttribute(agent.id)}"
      data-action="${escapeAttribute(action.id)}"
      title="${escapeAttribute(disabledReason || actionTitle(agent, action))}"
      aria-label="${escapeAttribute(`${action.label} ${agent.name}`)}"
      ${disabledReason ? "disabled" : ""}
    >
      ${escapeText(action.label)}
    </button>
  `;
}

function actionDisabledReason(agent, action) {
  if (action.surface && !agent.capabilities?.includes(action.id)) return `${action.label} is unavailable for this agent`;
  if (agent.capabilities && !agent.capabilities.includes(action.id)) return `${action.label} is not supported by ${agent.provider}`;
  if (agent.status === "ended" && action.id !== "start") return "Ended agents can only be started";
  if (agent.status === "running" && action.id === "start") return "Agent is already running";
  return "";
}

function actionTitle(agent, action) {
  if (action.id === "go-to") {
    if (agent.goToKind === "url") return `Open ${agent.windowTitle || agent.goToTarget || agent.remoteUrl}`;
    if (agent.goToKind) return `Bring ${agent.windowTitle || agent.name} forward`;
  }
  return `${action.label} ${agent.name}`;
}

function escapeAttribute(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeText(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

customElements.define("agent-monitor-widget", AgentMonitorWidget);
