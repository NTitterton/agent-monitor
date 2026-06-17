import {
  formatTokenRate,
  formatMemory,
  formatRuntime,
  agentActions,
  isTerminalStatus,
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
      this.providers = snapshot.providers;
      this.scanner = snapshot.scanner;
      this.snapshotAt = snapshot.snapshotAt;
      this.actionMessage = snapshot.actionMessage;
      this.render();
    });
    const refreshMs = Number(this.getAttribute("refresh-ms") || 3000);
    this.refreshTimer = window.setInterval(() => client.refresh(), clampRefreshMs(refreshMs));
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    if (this.refreshTimer) window.clearInterval(this.refreshTimer);
  }

  render() {
    const agents = this.agents || [];
    const visibleAgents = sortWidgetAgents(agents);
    const active = activeAgentCount(agents);

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <section class="widget">
        <header>
          <div>
            <p>Agent Monitor</p>
            <h2>${active} active</h2>
          </div>
          <span>${agents.length} total</span>
        </header>
        ${renderProviderSummary(this.providers || [], agents, this.snapshotAt)}
        ${renderScannerSummary(this.scanner)}
        <div class="list">
          ${visibleAgents.map((agent) => renderWidgetAgent(agent, agents)).join("")}
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
        const prompt = collectActionPrompt(action);
        if (prompt === null) return;
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
      <strong>${escapeText(latest.label)} · ${escapeText(actionKindLabel(latest))}</strong>
      <span>${escapeText(historyAgentLine(latest))}</span>
    </footer>
  `;
}

function collectActionPrompt(action) {
  if (action?.destructive && !window.confirm(`${action.label} is destructive. Continue?`)) return null;
  if (!action?.requiresPrompt) return "";
  return window.prompt(`${action.label} prompt`);
}

function historyAgentLine(record) {
  return [record.agentName, record.provider, record.type || record.source].filter(Boolean).join(" · ");
}

function actionKindLabel(record) {
  return record.actionKind === "surface" ? "Surface" : "Lifecycle";
}

function renderActionMessage(message) {
  if (!message) return "";

  return `
    <p class="action-message ${escapeAttribute(message.tone || "ok")}">
      ${escapeText(message.text || "")}
    </p>
  `;
}

function renderScannerSummary(scanner) {
  if (!scanner) return "";
  const state = scanner.enabled ? (scanner.running ? "Scanning now" : "Discovery on") : "Discovery off";
  const detail = scanner.lastFinishedAt ? `finished ${formatTimestamp(scanner.lastFinishedAt)}` : `${Math.round(Number(scanner.intervalMs || 3000) / 1000)}s interval`;
  const counts = `${Number(scanner.agentCount || 0)} agents · ${Number(scanner.providerCount || 0)} providers`;
  const error = scanner.lastError ? ` · ${scanner.lastError}` : "";
  return `<p class="source-summary">${escapeText(state)} · ${escapeText(detail)} · ${escapeText(counts)}${escapeText(error)}</p>`;
}

function renderProviderSummary(providers, agents, snapshotAt = null) {
  if (!providers.length && !agents.length) return "";

  const sources = new Set([
    ...providers.map((provider) => provider.source).filter(Boolean),
    ...agents.map((agent) => agent.source).filter(Boolean)
  ]);
  const issues = providers.filter((provider) => provider.status === "error").length;
  const providerCount = providers.length || new Set(agents.map((agent) => agent.provider).filter(Boolean)).size;
  const issueText = issues ? ` · ${issues} issue${issues === 1 ? "" : "s"}` : "";
  const snapshotText = snapshotAt ? ` · Updated ${formatTimestamp(snapshotAt)}` : "";
  return `
    <p class="source-summary">
      ${providerCount} provider${providerCount === 1 ? "" : "s"} · ${sources.size || 1} source${sources.size === 1 ? "" : "s"}${escapeText(issueText)}${escapeText(snapshotText)}
    </p>
  `;
}

function sortWidgetAgents(agents) {
  return [...agents].sort(compareWidgetAgents);
}

function activeAgentCount(agents) {
  return agents.filter((agent) => statusRank(agent) >= 40).length;
}

function compareWidgetAgents(a, b) {
  return (
    statusRank(b) - statusRank(a) ||
    priorityRank(b) - priorityRank(a) ||
    Number(b.cpu || 0) - Number(a.cpu || 0) ||
    Number(b.startedAt || 0) - Number(a.startedAt || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

function statusRank(agent) {
  const status = String(agent.status || "").toLowerCase();
  return {
    running: 50,
    processing: 50,
    in_progress: 50,
    waiting: 40,
    queued: 40,
    pending: 40,
    paused: 30,
    error: 20,
    failed: 20,
    cancelled: 20,
    canceled: 20,
    expired: 20,
    ended: 10,
    completed: 10,
    complete: 10,
    succeeded: 10,
    done: 10
  }[status] || 0;
}

function priorityRank(agent) {
  return { urgent: 4, high: 3, medium: 2, normal: 1, low: 0 }[String(agent.priority || "").toLowerCase()] ?? -1;
}

function renderWidgetAgent(agent, agents) {
  return `
    <article>
      <div class="agent-line">
        <div>
          <strong>${escapeText(agent.name)}</strong>
          <p>${escapeText(agent.provider)} · ${formatRuntime(agent)}</p>
          <p>${escapeText(lineageSummary(agent, agents))}</p>
          ${renderAgentContext(agent)}
          ${renderProviderObject(agent)}
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

function lineageSummary(agent, agents = []) {
  const childCount = agent.children.length;
  const parent = agent.parentId ? agents.find((item) => item.id === agent.parentId)?.name || agent.parentId : "Root";
  const childNames = agent.children
    .map((childId) => agents.find((item) => item.id === childId)?.name || childId)
    .slice(0, 2);
  const childSummary =
    childCount > 0
      ? `${childCount} child${childCount === 1 ? "" : "ren"}: ${childNames.join(", ")}${childCount > childNames.length ? "..." : ""}`
      : "No children";
  return `${parent} · ${childSummary}`;
}

function renderAgentContext(agent) {
  const context = agentContextLine(agent);
  return context ? `<p>${escapeText(context)}</p>` : "";
}

function renderProviderObject(agent) {
  const object = providerObjectLine(agent);
  return object ? `<p>${escapeText(object)}</p>` : "";
}

function providerObjectLine(agent) {
  const parts = [];
  if (agent.remoteId) parts.push(`remote ${agent.remoteId}`);
  if (agent.model) parts.push(`model ${agent.model}`);
  if (agent.requestCounts && typeof agent.requestCounts === "object") {
    const requestLine = Object.entries(agent.requestCounts)
      .filter(([, value]) => Number(value || 0) > 0)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");
    if (requestLine) parts.push(requestLine);
  }
  if (agent.goToKind && agent.goToKind !== "unknown") parts.push(`go-to ${agent.goToKind}`);
  return parts.join(" · ");
}

function agentContextLine(agent) {
  const repo = agent.repository && agent.branch ? `${agent.repository}@${agent.branch}` : agent.repository || agent.branch || "";
  return [
    agent.workspace,
    repo,
    agent.owner ? `owner ${agent.owner}` : "",
    agent.queue ? `queue ${agent.queue}` : "",
    agent.priority ? `priority ${agent.priority}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}

function renderResourceLine(agent) {
  const parts = [`${agent.cpu}% CPU`, formatMemory(agent.memoryMb)];
  if (Number.isFinite(Number(agent.progressPercent))) parts.push(`${Number(agent.progressPercent)}% progress`);
  if (agent.currentStep) parts.push(agent.currentStep);
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
  const spend = formatSpend(agent.costUsd);
  if (spend) parts.push(spend);
  return parts.join(" · ");
}

function formatSpend(costUsd) {
  const spend = Number(costUsd || 0);
  return Number.isFinite(spend) && spend > 0 ? `$${spend.toFixed(2)}` : "";
}

function formatTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  if (Array.isArray(agent.capabilities) && !agent.capabilities.includes(action.id)) {
    return `${agent.provider} did not advertise ${action.label}`;
  }
  if (isTerminalStatus(agent.status) && action.id !== "start" && !action.surface) return "Terminal agents can only be started";
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

function clampRefreshMs(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.round(number), 1000), 300000) : 3000;
}

customElements.define("agent-monitor-widget", AgentMonitorWidget);
