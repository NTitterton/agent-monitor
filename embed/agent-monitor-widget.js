const fallbackAgents = [];

const actions = [
  { id: "start", label: "Start", prompt: false },
  { id: "stop", label: "Stop", prompt: false },
  { id: "interrupt", label: "Interrupt", prompt: true },
  { id: "end", label: "End", prompt: true },
  { id: "force-end", label: "Force End", prompt: false, danger: true },
  { id: "go-to", label: "Go To", prompt: false, surface: true }
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

  .source-summary {
    margin: 0;
    padding: 10px 20px;
    border-top: 1px solid #e6e9ef;
    background: #f7f9fc;
    color: #5d687a;
    font-size: 0.8rem;
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

  .log-preview {
    margin-top: 8px;
    color: #344054;
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

  .action-message {
    margin: 0;
    padding: 10px 20px;
    border-top: 1px solid #e6e9ef;
    background: #eef5ff;
    color: #244c7a;
    font-size: 0.8rem;
  }

  .action-message.warn {
    background: #fff8e8;
    color: #7a4d00;
  }

  .action-message.error {
    background: #fff8f8;
    color: #a62626;
  }
`;

class StandaloneAgentMonitorWidget extends HTMLElement {
  static get observedAttributes() {
    return ["api-base", "api-token", "auth-header", "refresh-ms"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.agents = normalizeWidgetAgents(fallbackAgents);
    this.providers = [];
    this.scanner = null;
    this.history = [];
    this.snapshotAt = null;
    this.actionMessage = null;
  }

  connectedCallback() {
    this.render();
    void this.refresh();
    this.scheduleRefresh();
  }

  disconnectedCallback() {
    window.clearInterval(this.refreshTimer);
  }

  attributeChangedCallback() {
    if (!this.isConnected) return;
    this.scheduleRefresh();
    void this.refresh();
  }

  scheduleRefresh() {
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = window.setInterval(() => this.refresh(), this.refreshMs());
  }

  async refresh() {
    const apiBase = this.apiBase();
    if (!apiBase) return;

    try {
      const payload = await this.fetchSnapshot(apiBase);
      this.agents = normalizeWidgetAgents(payload.agents || []);
      this.history = payload.history || [];
      this.providers = payload.providers || [];
      this.scanner = normalizeScanner(payload.scanner);
      this.snapshotAt = normalizeOptionalTimestamp(payload.snapshotAt);
      this.render();
    } catch {
      this.render();
    }
  }

  async fetchSnapshot(apiBase) {
    const response = await fetch(`${apiBase}/api/snapshot`, { headers: this.headers() });
    if (response.ok) return response.json();
    return this.fetchLegacySnapshot(apiBase);
  }

  async fetchLegacySnapshot(apiBase) {
    const response = await fetch(`${apiBase}/api/agents`, { headers: this.headers() });
    if (!response.ok) throw new Error(`Agent Monitor returned ${response.status}`);
    return response.json();
  }

  async perform(agentId, action) {
    const apiBase = this.apiBase();
    const prompt = collectActionPrompt(action);
    if (prompt === null) return;
    const agent = this.agents.find((item) => item.id === agentId);

    if (action.id === "go-to" && isUrlGoTo(agent)) {
      window.open(agent.goToTarget || agent.remoteUrl, "_blank", "noopener");
      return;
    }

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
      if (!response.ok) {
        const payload = await readJsonResponse(response);
        this.agents = payload?.agents ? normalizeWidgetAgents(payload.agents) : this.agents;
        this.history = payload?.history || this.history;
        this.providers = payload?.providers || this.providers;
        this.scanner = payload?.scanner ? normalizeScanner(payload.scanner) : this.scanner;
        this.snapshotAt = normalizeOptionalTimestamp(payload?.snapshotAt) || this.snapshotAt;
        this.actionMessage = {
          tone: response.status >= 500 ? "error" : "warn",
          text: payload?.error || `Action failed (${response.status})`
        };
        this.render();
        return;
      }
      const payload = await response.json();
      this.agents = payload.agents ? normalizeWidgetAgents(payload.agents) : this.agents;
      this.history = payload.history || this.history;
      this.providers = payload.providers || this.providers;
      this.scanner = payload.scanner ? normalizeScanner(payload.scanner) : this.scanner;
      this.snapshotAt = normalizeOptionalTimestamp(payload.snapshotAt) || this.snapshotAt;
      this.actionMessage = actionResultMessage(action, this.agents, agentId, agent);
      this.render();
    } catch {
      this.applyLocalAction(agentId, action, prompt);
    }
  }

  applyLocalAction(agentId, action, prompt) {
    const at = Date.now();
    this.agents = normalizeWidgetAgents(this.agents.map((agent) => {
      if (agent.id !== agentId) return agent;
      const nextStatus = statusForAction(action.id);
      const ending = nextStatus === "ended";
      const starting = nextStatus === "running";
      return {
        ...agent,
        status: nextStatus,
        cpu: ending ? 0 : agent.cpu,
        memoryMb: ending ? 0 : agent.memoryMb,
        tokensPerSecond: ending ? 0 : agent.tokensPerSecond,
        startedAt: starting ? at : agent.startedAt,
        endedAt: ending ? at : undefined,
        lastAction: { action: action.id, label: action.label, prompt, at },
        logs: [
          {
            at,
            level: action.danger ? "error" : "info",
            source: "operator",
            message: `${action.label}${prompt.trim() ? `: ${prompt.trim()}` : ""}`
          },
          ...(Array.isArray(agent.logs) ? agent.logs : [])
        ].slice(0, 50)
      };
    }));
    const agent = this.agents.find((item) => item.id === agentId);
    if (agent) {
      this.history = [
        {
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
          prompt,
          at
        },
        ...this.history
      ].slice(0, 8);
      this.snapshotAt = null;
      this.scanner = null;
      this.actionMessage = { tone: "ok", text: `${action.label} applied locally to ${agent.name}` };
    }
    this.render();
  }

  render() {
    const active = activeAgentCount(this.agents);
    const visibleAgents = sortWidgetAgents(this.agents);
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <section class="widget">
        <header>
          <div>
            <p>Agent Monitor</p>
            <h2>${active} active</h2>
          </div>
          <span>${this.agents.length} total</span>
        </header>
        ${renderProviderSummary(this.providers, this.agents, this.snapshotAt)}
        ${renderScannerSummary(this.scanner)}
        ${visibleAgents.map((agent) => this.renderAgent(agent)).join("")}
        ${this.renderActionMessage()}
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
            <p>${escapeHtml(lineageSummary(agent, this.agents))}</p>
            ${renderAgentContext(agent)}
            ${renderProviderObject(agent)}
          </div>
          <span class="status ${tone(agent.status)}">${escapeHtml(agent.status)}</span>
        </div>
        <p class="metrics">${formatResourceLine(agent)}</p>
        ${renderLatestLog(agent)}
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
    return `<footer><strong>${escapeHtml(latest.label)} · ${escapeHtml(actionKindLabel(latest))}</strong><span>${escapeHtml(historyAgentLine(latest))}</span></footer>`;
  }

  renderActionMessage() {
    if (!this.actionMessage) return "";
    return `<p class="action-message ${this.actionMessage.tone || "ok"}">${escapeHtml(this.actionMessage.text || "")}</p>`;
  }

  apiBase() {
    return this.getAttribute("api-base")?.replace(/\/+$/, "") || "";
  }

  apiToken() {
    return this.getAttribute("api-token")?.trim() || "";
  }

  authHeader() {
    return this.getAttribute("auth-header")?.trim().toLowerCase() || "x-agent-monitor-token";
  }

  refreshMs() {
    const value = Number(this.getAttribute("refresh-ms") || 3000);
    return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 1000), 300000) : 3000;
  }

  headers() {
    const token = this.apiToken();
    const tokenHeader = this.authHeader() === "authorization"
      ? { Authorization: `Bearer ${token}` }
      : { "X-Agent-Monitor-Token": token };
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? tokenHeader : {})
    };
  }
}

function renderAction(agent, action) {
  const disabledReason = actionDisabledReason(agent, action);
  return `
    <button
      class="${action.danger ? "danger" : ""}"
      type="button"
      data-agent-id="${escapeHtml(agent.id)}"
      data-action="${escapeHtml(action.id)}"
      title="${escapeHtml(disabledReason || actionTitle(agent, action))}"
      aria-label="${escapeHtml(`${action.label} ${agent.name}`)}"
      ${disabledReason ? "disabled" : ""}
    >
      ${escapeHtml(action.label)}
    </button>
  `;
}

function collectActionPrompt(action) {
  if (action?.danger && !window.confirm(`${action.label} is destructive. Continue?`)) return null;
  if (!action?.prompt) return "";
  return window.prompt(`${action.label} prompt`);
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
      ${providerCount} provider${providerCount === 1 ? "" : "s"} · ${sources.size || 1} source${sources.size === 1 ? "" : "s"}${escapeHtml(issueText)}${escapeHtml(snapshotText)}
    </p>
  `;
}

function renderScannerSummary(scanner) {
  if (!scanner) return "";
  const state = scanner.enabled ? (scanner.running ? "Scanning now" : "Discovery on") : "Discovery off";
  const detail = scanner.lastFinishedAt ? `finished ${formatTimestamp(scanner.lastFinishedAt)}` : `${Math.round(Number(scanner.intervalMs || 3000) / 1000)}s interval`;
  const counts = `${Number(scanner.agentCount || 0)} agents · ${Number(scanner.providerCount || 0)} providers`;
  const error = scanner.lastError ? ` · ${scanner.lastError}` : "";
  return `<p class="source-summary">${escapeHtml(state)} · ${escapeHtml(detail)} · ${escapeHtml(counts)}${escapeHtml(error)}</p>`;
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

function normalizeWidgetAgents(agents) {
  if (!Array.isArray(agents)) return [];
  return agents.map(normalizeWidgetAgent);
}

function normalizeWidgetAgent(agent) {
  const tokens = finiteNumber(agent.tokens);
  return {
    ...agent,
    type: agent.type || agent.providerId || agent.source || "unknown",
    cpu: finiteNumber(agent.cpu),
    memoryMb: finiteNumber(agent.memoryMb),
    processCpu: finiteNumber(agent.processCpu),
    processMemoryMb: finiteNumber(agent.processMemoryMb),
    childCpu: finiteNumber(agent.childCpu),
    childMemoryMb: finiteNumber(agent.childMemoryMb),
    tokens,
    tokensPerSecond: finiteNumber(agent.tokensPerSecond),
    tokenRateWindowMs: finiteNumber(agent.tokenRateWindowMs),
    tokenCountConfidence: normalizeTokenConfidence(agent.tokenCountConfidence, tokens ? "estimated" : "unknown"),
    costUsd: finiteNumber(agent.costUsd),
    startedAt: normalizeTimestamp(agent.startedAt),
    endedAt: agent.endedAt ? normalizeTimestamp(agent.endedAt, null) : undefined,
    progressPercent: normalizeProgress(agent.progressPercent),
    remoteId: normalizeOptionalString(agent.remoteId ?? agent.remote_id ?? agent.providerObjectId),
    model: String(agent.model || "").trim(),
    requestCounts: normalizeRequestCounts(agent.requestCounts ?? agent.request_counts),
    parentId: normalizeOptionalString(agent.parentId),
    children: normalizeStringList(agent.children),
    pid: normalizeOptionalPid(agent.pid),
    parentPid: normalizeOptionalPid(agent.parentPid),
    childPids: normalizePidList(agent.childPids),
    capabilities: normalizeCapabilities(agent.capabilities),
    logs: normalizeLogs(agent.logs),
    transcript: normalizeTranscript(agent.transcript)
  };
}

function normalizeScanner(scanner) {
  if (!scanner || typeof scanner !== "object") return null;
  return {
    enabled: scanner.enabled === true,
    running: scanner.running === true,
    intervalMs: finiteNumber(scanner.intervalMs, 3000),
    lastScanAt: normalizeOptionalTimestamp(scanner.lastScanAt),
    lastFinishedAt: normalizeOptionalTimestamp(scanner.lastFinishedAt),
    lastError: normalizeOptionalString(scanner.lastError),
    providerCount: finiteNumber(scanner.providerCount),
    agentCount: finiteNumber(scanner.agentCount),
    errors: finiteNumber(scanner.errors)
  };
}

function normalizeTokenConfidence(value, fallback = "unknown") {
  return ["observed", "estimated", "reported", "unknown"].includes(value) ? value : fallback;
}

function normalizeRequestCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [String(key).trim(), Number(count)])
      .filter(([key, count]) => key && Number.isFinite(count))
  );
}

function normalizeProgress(value) {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.min(Math.max(Math.round(progress), 0), 100) : null;
}

function normalizeOptionalString(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeOptionalPid(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePidList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeOptionalPid).filter((pid) => pid !== null);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTimestamp(value, fallback = Date.now()) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? fallback : parsed;
}

function normalizeOptionalTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  return normalizeTimestamp(value, null);
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];
  return logs
    .filter((log) => log && log.message)
    .map((log) => ({
      ...log,
      at: normalizeTimestamp(log.at),
      message: String(log.message)
    }))
    .slice(0, 50);
}

function normalizeTranscript(transcript) {
  if (!Array.isArray(transcript)) return [];
  return transcript
    .filter((entry) => entry && (entry.content || entry.message || entry.text))
    .map((entry) => ({
      ...entry,
      at: normalizeTimestamp(entry.at),
      content: String(entry.content || entry.message || entry.text).trim()
    }))
    .slice(0, 100);
}

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return [];
  const knownActions = new Set(actions.map((action) => action.id));
  return [...new Set(capabilities.map((capability) => String(capability).trim()).filter((capability) => knownActions.has(capability)))];
}

function historyAgentLine(record) {
  return [record.agentName, record.provider, record.type || record.source].filter(Boolean).join(" · ");
}

function actionKindLabel(record) {
  return record.actionKind === "surface" ? "Surface" : "Lifecycle";
}

function actionResultMessage(action, nextAgents = [], agentId, fallbackAgent = null) {
  const agent = Array.isArray(nextAgents) ? nextAgents.find((item) => item.id === agentId) : null;
  const target = agent || fallbackAgent || { id: agentId };
  return {
    tone: "ok",
    text: [
      `${action.label} sent to ${target.name || target.id || agentId}`,
      target.status ? `status ${target.status}` : "",
      target.provider ? `provider ${target.provider}` : ""
    ].filter(Boolean).join(" · ")
  };
}

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

function isTerminalStatus(status) {
  return terminalStatuses.has(String(status || "").toLowerCase());
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
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
  const startedAt = Number(agent?.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return "Unknown runtime";
  const endedAt = Number(agent?.endedAt);
  const end = Number.isFinite(endedAt) && endedAt > 0 ? endedAt : Date.now();
  const totalMinutes = Math.max(1, Math.round((end - startedAt) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMemory(memoryMb) {
  return memoryMb >= 1024 ? `${(memoryMb / 1024).toFixed(1)} GB` : `${memoryMb} MB`;
}

function isUrlGoTo(agent) {
  if (!agent) return false;
  const target = agent.goToTarget || agent.remoteUrl;
  return agent.goToKind === "url" && /^https?:\/\//i.test(target || "");
}

function formatResourceLine(agent) {
  const parts = [`${Number(agent.cpu || 0)}% CPU`, formatMemory(Number(agent.memoryMb || 0))];
  if (Number.isFinite(Number(agent.progressPercent))) parts.push(`${Number(agent.progressPercent)}% progress`);
  if (agent.currentStep) parts.push(agent.currentStep);
  if (agent.childCpu || agent.childMemoryMb) {
    parts.push(`children ${Number(agent.childCpu || 0)}% / ${formatMemory(Number(agent.childMemoryMb || 0))}`);
  }
  if (agent.pid) parts.push(`PID ${agent.pid}`);
  if (agent.parentPid) parts.push(`PPID ${agent.parentPid}`);
  if (agent.childPids?.length) parts.push(`${agent.childPids.length} child PID${agent.childPids.length === 1 ? "" : "s"}`);
  if (agent.tokens) parts.push(`${Number(agent.tokens).toLocaleString()} tokens`);
  const rate = Number(agent.tokensPerSecond || 0);
  if (Number.isFinite(rate) && rate > 0) parts.push(`${rate >= 10 ? rate.toFixed(0) : rate.toFixed(1)} tok/s`);
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

function renderAgentContext(agent) {
  const context = agentContextLine(agent);
  return context ? `<p>${escapeHtml(context)}</p>` : "";
}

function renderProviderObject(agent) {
  const object = providerObjectLine(agent);
  return object ? `<p>${escapeHtml(object)}</p>` : "";
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

function renderLatestLog(agent) {
  const log = Array.isArray(agent.logs) ? agent.logs[0] : null;
  if (!log) return "";
  return `<p class="log-preview">${escapeHtml(log.source || "agent")} · ${escapeHtml(log.message)}</p>`;
}

function lineageSummary(agent, agents = []) {
  const childCount = Array.isArray(agent.children) ? agent.children.length : 0;
  const parent = agent.parentId ? agents.find((item) => item.id === agent.parentId)?.name || agent.parentId : "Root";
  const childNames = (Array.isArray(agent.children) ? agent.children : [])
    .map((childId) => agents.find((item) => item.id === childId)?.name || childId)
    .slice(0, 2);
  const childSummary =
    childCount > 0
      ? `${childCount} child${childCount === 1 ? "" : "ren"}: ${childNames.join(", ")}${childCount > childNames.length ? "..." : ""}`
      : "No children";
  return `${parent} · ${childSummary}`;
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
