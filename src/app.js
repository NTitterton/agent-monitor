import {
  formatTokenRate,
  formatMemory,
  formatRuntime,
  agentActions,
  isTerminalStatus,
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
      this.config = snapshot.config;
      this.scanner = snapshot.scanner;
      this.snapshotAt = snapshot.snapshotAt;
      this.actionMessage = snapshot.actionMessage;
      this.mode = snapshot.mode;
      this.selectedAgentId = snapshot.agents.some((agent) => agent.id === this.selectedAgentId)
        ? this.selectedAgentId
        : snapshot.agents[0]?.id || null;
      this.detail = buildDetail(this.selectedAgentId, snapshot.agents, snapshot.history);
      this.configurePolling(snapshot.config, snapshot.mode);
      this.render();
    });
  }

  disconnectedCallback() {
    this.unsubscribe?.();
    this.clearPolling();
  }

  configurePolling(config, mode) {
    const refresh = config?.snapshotRefresh || {};
    const enabled = mode === "api" && refresh.enabled === true;
    const intervalMs = Number(refresh.intervalMs || 3000);
    const nextKey = enabled ? `${intervalMs}` : "";
    if (this.pollingKey === nextKey) return;

    this.clearPolling();
    this.pollingKey = nextKey;
    if (enabled) {
      this.refreshTimer = window.setInterval(() => client.refresh(), intervalMs);
    }
  }

  clearPolling() {
    if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.pollingKey = "";
  }

  render() {
    const agents = this.agents || [];
    const filters = { query: "", status: "all", source: "all", type: "all", provider: "all", sort: "started-desc", ...(this.filters || {}) };
    const filteredAgents = filterAgents(agents, filters);
    const viewMode = this.viewMode || "table";
    if (this.officeFocusAgentId && !filteredAgents.some((agent) => agent.id === this.officeFocusAgentId)) {
      this.officeFocusAgentId = null;
    }
    const active = activeAgentCount(agents);
    const cpu = agents.reduce((total, agent) => total + Number(agent.cpu || 0), 0);
    const memory = agents.reduce((total, agent) => total + agent.memoryMb, 0);
    const tokens = agents.reduce((total, agent) => total + Number(agent.tokens || 0), 0);
    const tokenRate = agents.reduce((total, agent) => total + Number(agent.tokensPerSecond || 0), 0);
    const spend = agents.reduce((total, agent) => total + Number(agent.costUsd || 0), 0);
    const history = this.history || [];
    const providerIssues = (this.providers || []).filter((provider) => provider.status === "error").length;
    const selectedDetail = this.detail || buildDetail(this.selectedAgentId, agents, history);
    const sources = [...new Set(agents.map((agent) => agent.source))].sort();
    const statuses = [...new Set(agents.map((agent) => agent.status))].filter(Boolean).sort();
    const types = [...new Set(agents.map((agent) => agent.type || agent.providerId || agent.source))].sort();
    const providers = agentProviderOptions(agents);
    const previousSourcesScrollTop = this.querySelector(".sources-panel")?.scrollTop || 0;
    const focusedFilter = captureFocusedFilter(this);
    const openPanels = captureOpenPanels(this);

    this.innerHTML = `
      <main class="app-shell">
        <header class="topbar">
          <div>
            <p class="eyebrow">Local-first control plane${this.snapshotAt ? ` · Updated ${formatTimestamp(this.snapshotAt)}` : ""}</p>
            <h1>Agent Monitor</h1>
          </div>
          <div class="summary-grid" aria-label="Agent summary">
            <article>
              <span>${filteredAgents.length}/${agents.length}</span>
              <p>Visible</p>
            </article>
            <article>
              <span>${active}</span>
              <p>Active</p>
            </article>
            <article>
              <span>${formatMemory(memory)}</span>
              <p>Memory</p>
            </article>
            <article>
              <span>${formatCpu(cpu)}</span>
              <p>CPU</p>
            </article>
            <article>
              <span>${formatTokenTotal(tokens)}</span>
              <p>Tokens</p>
            </article>
            <article>
              <span>${formatTokenRate({ tokensPerSecond: tokenRate })}</span>
              <p>Tok/sec</p>
            </article>
            <article>
              <span>$${spend.toFixed(2)}</span>
              <p>Spend</p>
            </article>
            <article class="${providerIssues ? "summary-warning" : ""}">
              <span>${providerIssues}</span>
              <p>Provider Issues</p>
            </article>
          </div>
        </header>

        <section class="workspace">
          <aside class="panel sources-panel">
            <h2>Sources</h2>
            ${renderScannerStatus(this.scanner)}
            ${renderSourceList(agents, this.providers || [])}
            ${renderSettings(this.config, this.mode, this.settingsMessage)}
            ${renderLineageTree(agents)}
            ${renderHistory(history, this.mode)}
          </aside>
          <section class="panel agent-panel">
            <div class="panel-heading">
              <h2>Agent Tasks</h2>
              <div class="panel-tools">
                ${renderViewToggle(viewMode)}
                <button class="icon-button" type="button" title="Refresh snapshots" data-refresh>↻</button>
              </div>
            </div>
            ${renderFilters(filters, sources, types, providers, statuses)}
            ${renderActionMessage(this.actionMessage)}
            ${
              viewMode === "office"
                ? renderOfficeView(filteredAgents, agents, this.providers || [], this.selectedAgentId, this.officeFocusAgentId)
                : `<div class="agent-table" role="table" aria-label="Agent task table">
                    ${renderAgentTable(filteredAgents, agents, this.providers || [], this.selectedAgentId)}
                  </div>`
            }
            ${renderDetailPanel(selectedDetail, this.providers || [])}
          </section>
        </section>
      </main>
    `;

    const sourcesPanel = this.querySelector(".sources-panel");
    if (sourcesPanel) sourcesPanel.scrollTop = previousSourcesScrollTop;
    restoreOpenPanels(this, openPanels);
    restoreFocusedFilter(this, focusedFilter);
    const officeCanvas = this.querySelector("[data-office-canvas]");
    if (officeCanvas) {
      const hitBoxes = drawOfficeView(officeCanvas, filteredAgents, this.selectedAgentId, this.officeFocusAgentId);
      officeCanvas.addEventListener("click", async (event) => {
        const hit = officeHitTest(officeCanvas, hitBoxes, event);
        if (!hit) return;
        this.officeFocusAgentId = hit.agent.id;
        this.selectedAgentId = hit.agent.id;
        this.detail = buildDetail(this.selectedAgentId, this.agents || [], this.history || []);
        this.render();
        this.detail = await client.detail(this.selectedAgentId);
        this.render();
      });
    }
    this.querySelector("[data-office-floor]")?.addEventListener("click", () => {
      this.officeFocusAgentId = null;
      this.render();
    });

    this.querySelector("[data-refresh]")?.addEventListener("click", () => client.refresh());
    this.querySelectorAll("[data-view-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        this.viewMode = button.getAttribute("data-view-mode") || "table";
        this.render();
      });
    });
    this.querySelector(".settings-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const apiToken = form.querySelector('[data-setting="apiToken"]').value.trim();
      const patch = {
        allowedOrigins: parseLines(form.querySelector('[data-setting="allowedOrigins"]').value),
        ...(apiToken ? { apiToken } : {}),
        localDiscovery: {
          enabled: form.querySelector('[data-setting="localDiscoveryEnabled"]').checked,
          include: parseLines(form.querySelector('[data-setting="localDiscoveryInclude"]').value),
          exclude: parseLines(form.querySelector('[data-setting="localDiscoveryExclude"]').value)
        },
        localAgents: parseLocalAgents(form),
        snapshotRefresh: {
          enabled: form.querySelector('[data-setting="snapshotRefreshEnabled"]').checked,
          intervalMs: Number(form.querySelector('[data-setting="snapshotRefreshIntervalMs"]').value || 3000)
        },
        remoteHttpProviders: parseRemoteProviders(form),
        openAIResponsesProviders: parseOpenAIProviders(form),
        anthropicMessageBatchesProviders: parseAnthropicProviders(form)
      };

      try {
        this.settingsMessage = "Saved";
        this.config = await client.updateConfig(patch);
        if (this.config?.validationWarnings?.length) {
          this.settingsMessage = `Saved with ${this.config.validationWarnings.length} warning${this.config.validationWarnings.length === 1 ? "" : "s"}`;
        }
        this.render();
      } catch {
        this.settingsMessage = "Save failed";
        this.render();
      }
    });
    this.querySelector(".filter-bar")?.addEventListener("submit", (event) => event.preventDefault());
    this.querySelectorAll("[data-filter]").forEach((input) => {
      input.addEventListener("input", () => {
        this.filters = {
          query: this.querySelector('[data-filter="query"]').value,
          status: this.querySelector('[data-filter="status"]').value,
          source: this.querySelector('[data-filter="source"]').value,
          type: this.querySelector('[data-filter="type"]').value,
          provider: this.querySelector('[data-filter="provider"]').value,
          sort: this.querySelector('[data-filter="sort"]').value
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
      button.addEventListener("click", async () => {
        const agentId = button.getAttribute("data-agent-id");
        const actionId = button.getAttribute("data-action");
        const action = agentActions.find((item) => item.id === actionId);
        const prompt = collectActionPrompt(action);
        if (prompt === null) return;

        this.actionMessage = await client.perform(agentId, actionId, prompt);
        this.render();
      });
    });
  }
}

function renderActionMessage(message) {
  if (!message) return "";
  return `<p class="action-message ${message.tone || "ok"}">${escapeText(message.text || "")}</p>`;
}

function renderViewToggle(viewMode) {
  return `
    <div class="view-toggle" role="group" aria-label="Agent view">
      ${["table", "office"]
        .map(
          (mode) => `
            <button
              class="view-button ${viewMode === mode ? "active" : ""}"
              type="button"
              data-view-mode="${mode}"
              aria-pressed="${viewMode === mode ? "true" : "false"}"
            >
              ${mode === "table" ? "Table" : "Office"}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function captureFocusedFilter(root) {
  const active = root.ownerDocument.activeElement;
  if (!active || !root.contains(active) || !active.matches?.("[data-filter]")) return null;
  return {
    key: active.getAttribute("data-filter"),
    selectionStart: active.selectionStart,
    selectionEnd: active.selectionEnd
  };
}

function captureOpenPanels(root) {
  return {
    settings: Boolean(root.querySelector(".settings-block")?.open),
    detail: Boolean(root.querySelector(".detail-panel")?.open)
  };
}

function restoreOpenPanels(root, openPanels) {
  if (!openPanels) return;
  const settings = root.querySelector(".settings-block");
  if (settings && openPanels.settings) settings.open = true;
  const detail = root.querySelector(".detail-panel");
  if (detail && openPanels.detail) detail.open = true;
}

function restoreFocusedFilter(root, focusedFilter) {
  if (!focusedFilter?.key) return;
  const next = root.querySelector(`[data-filter="${cssEscape(focusedFilter.key)}"]`);
  if (!next) return;
  next.focus({ preventScroll: true });
  if (typeof next.setSelectionRange === "function" && Number.isFinite(focusedFilter.selectionStart)) {
    next.setSelectionRange(focusedFilter.selectionStart, focusedFilter.selectionEnd ?? focusedFilter.selectionStart);
  }
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function collectActionPrompt(action) {
  if (action?.destructive && !window.confirm(`${action.label} is destructive. Continue?`)) return null;
  if (!action?.requiresPrompt) return "";
  return window.prompt(`${action.label} prompt`);
}

function renderFilters(filters, sources, types, providers, statuses) {
  return `
    <form class="filter-bar" aria-label="Agent filters">
      <label>
        <span>Search</span>
        <input data-filter="query" type="search" value="${escapeAttribute(filters.query)}" placeholder="Name, task, provider, repo, queue" />
      </label>
      <label>
        <span>Status</span>
        <select data-filter="status">
          ${["all", ...statuses].map((status) => renderOption(status, filters.status, status === "all" ? "All" : labelize(status))).join("")}
        </select>
      </label>
      <label>
        <span>Source</span>
        <select data-filter="source">
          ${["all", ...sources].map((source) => renderOption(source, filters.source, source === "all" ? "All" : labelize(source))).join("")}
        </select>
      </label>
      <label>
        <span>Type</span>
        <select data-filter="type">
          ${["all", ...types].map((type) => renderOption(type, filters.type, type === "all" ? "All" : labelize(type))).join("")}
        </select>
      </label>
      <label>
        <span>Provider</span>
        <select data-filter="provider">
          ${[{ id: "all", label: "All" }, ...providers].map((provider) => renderOption(provider.id, filters.provider, provider.label)).join("")}
        </select>
      </label>
      <label>
        <span>Sort</span>
        <select data-filter="sort">
          ${[
            ["started-desc", "Newest"],
            ["cpu-desc", "CPU"],
            ["memory-desc", "Memory"],
            ["spend-desc", "Spend"],
            ["tokens-desc", "Tokens"],
            ["runtime-desc", "Runtime"],
            ["priority-desc", "Priority"],
            ["status-asc", "Status Pressure"]
          ]
            .map(([value, label]) => renderOption(value, filters.sort, label))
            .join("")}
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
              <div class="history-title">
                <strong>${escapeText(record.label)}</strong>
                <span>${escapeText(actionKindLabel(record))}</span>
              </div>
              <p>${escapeText(historyAgentLine(record))} · ${formatTimestamp(record.at)}</p>
              ${record.prompt ? `<p class="prompt-text">${escapeText(record.prompt)}</p>` : ""}
            </article>
          `
        )
        .join("")}
    </section>
  `;
}

function historyAgentLine(record) {
  return [
    record.agentName,
    record.provider,
    record.type ? labelize(record.type) : "",
    record.source ? labelize(record.source) : ""
  ]
    .filter(Boolean)
    .filter(unique)
    .join(" · ");
}

function actionKindLabel(record) {
  return record.actionKind === "surface" ? "Surface" : "Lifecycle";
}

function renderSourceList(agents, providers) {
  const bySource = agents.reduce((groups, agent) => {
    const sourceAgents = groups.get(agent.source) || [];
    sourceAgents.push(agent);
    groups.set(agent.source, sourceAgents);
    return groups;
  }, new Map());

  const sourceLines = [...bySource.entries()].map(([source, sourceAgents]) => {
    const active = activeAgentCount(sourceAgents);
    return `${sourceAgents.length} ${labelize(source).toLowerCase()}${active ? `, ${active} active` : ""}`;
  });
  const providerLines = providers.map((provider) => {
    const status = provider.status === "error" ? `error: ${provider.error || "unavailable"}` : "ok";
    return `${Number(provider.agentCount || 0)} ${providerLabel(provider)} · ${status}`;
  });
  const providerIssues = providers.filter((provider) => provider.status === "error").length;
  return `
    <article class="source-row compact-source-row ${providerIssues ? "source-error" : ""}">
      <div>
        <strong>${agents.length} agents</strong>
        <p>${activeAgentCount(agents)} active · ${providerIssues} provider issues</p>
      </div>
      <span>${escapeText([...sourceLines, ...providerLines].join(" · ") || "No agents discovered yet")}</span>
    </article>
  `;
}

function providerLabel(provider) {
  const type = String(provider.type || provider.id || "provider").toLowerCase();
  if (type === "local") return "local";
  if (type === "openai") return "openai";
  if (type === "anthropic") return "anthropic";
  if (type === "remote") return "remote";
  return type;
}

function activeAgentCount(agents) {
  return agents.filter((agent) => statusRank(agent) >= 40).length;
}

function renderScannerStatus(scanner) {
  if (!scanner) return "";
  const state = scanner.enabled ? (scanner.running ? "Scanning now" : "Background scan on") : "Background scan off";
  const interval = `${formatSeconds(Number(scanner.intervalMs || 3000))} interval`;
  const detail = scanner.lastFinishedAt ? `finished ${formatScanFreshness([{ scannedAt: scanner.lastFinishedAt }])}` : "not finished";
  return `
    <article class="source-row ${scanner.lastError ? "source-error" : ""}">
      <div>
        <strong>Active Discovery</strong>
        <p>${escapeText(state)} · ${escapeText(interval)}</p>
      </div>
      <span>${escapeText(scannerSummaryLine(scanner, detail))}</span>
    </article>
  `;
}

function scannerSummaryLine(scanner, detail) {
  return [
    detail,
    scanner.lastScanAt ? `started ${formatScanFreshness([{ scannedAt: scanner.lastScanAt }])}` : "",
    `${Number(scanner.agentCount || 0)} agents`,
    `${Number(scanner.providerCount || 0)} providers`,
    scanner.lastError || ""
  ].filter(Boolean).join(" · ");
}

function renderSettings(config, mode = "local", message = "") {
  const discovery = config?.localDiscovery || { enabled: true, include: [], exclude: [] };
  const snapshotRefresh = config?.snapshotRefresh || { enabled: true, intervalMs: 3000 };
  const providerCounts = config?.providerCounts || {};
  const localAgents = config?.localAgents || [];
  const remoteProviders = config?.remoteHttpProviders || [];
  const openAIProviders = config?.openAIResponsesProviders || [];
  const anthropicProviders = config?.anthropicMessageBatchesProviders || [];
  return `
    <details class="settings-block" ${message ? "open" : ""}>
      <summary class="settings-heading">
        <h2>Settings</h2>
        <span>${message ? escapeText(message) : "Configure"}</span>
      </summary>
      ${renderValidationWarnings(config?.validationWarnings || [])}
      <form class="settings-form">
        <label>
          <span>Trusted Origins</span>
          <textarea data-setting="allowedOrigins" rows="3" ${mode === "api" ? "" : "disabled"}>${escapeText((config?.allowedOrigins || []).join("\n"))}</textarea>
        </label>
        <label>
          <span>Embed API Token</span>
          <input data-setting="apiToken" type="password" value="" placeholder="${config?.hasApiToken ? "Token saved" : "No token"}" ${mode === "api" ? "" : "disabled"} />
        </label>
        <label class="toggle-row">
          <input data-setting="localDiscoveryEnabled" type="checkbox" ${discovery.enabled ? "checked" : ""} ${mode === "api" ? "" : "disabled"} />
          <span>Local Discovery</span>
        </label>
        <label class="toggle-row">
          <input data-setting="snapshotRefreshEnabled" type="checkbox" ${snapshotRefresh.enabled ? "checked" : ""} ${mode === "api" ? "" : "disabled"} />
          <span>Auto Refresh</span>
        </label>
        <label>
          <span>Refresh Interval (ms)</span>
          <input data-setting="snapshotRefreshIntervalMs" type="number" min="1000" max="300000" step="1000" value="${Number(snapshotRefresh.intervalMs || 3000)}" ${mode === "api" ? "" : "disabled"} />
        </label>
        <label>
          <span>Discovery Include</span>
          <textarea data-setting="localDiscoveryInclude" rows="2" ${mode === "api" ? "" : "disabled"}>${escapeText((discovery.include || []).join("\n"))}</textarea>
        </label>
        <label>
          <span>Discovery Exclude</span>
          <textarea data-setting="localDiscoveryExclude" rows="2" ${mode === "api" ? "" : "disabled"}>${escapeText((discovery.exclude || []).join("\n"))}</textarea>
        </label>
        <div class="remote-provider-list">
          <span>Local Agents</span>
          ${renderLocalAgentRows(localAgents, mode)}
        </div>
        <div class="remote-provider-list">
          <span>Remote Providers</span>
          ${renderRemoteProviderRows(remoteProviders, mode)}
        </div>
        <div class="remote-provider-list">
          <span>OpenAI Responses</span>
          ${renderOpenAIProviderRows(openAIProviders, mode)}
        </div>
        <div class="remote-provider-list">
          <span>Anthropic Batches</span>
          ${renderAnthropicProviderRows(anthropicProviders, mode)}
        </div>
        <div class="settings-meta">
          <span>${providerCounts.localAgents || 0} local</span>
          <span>${providerCounts.remoteHttpProviders || 0} remote</span>
          <span>${providerCounts.openAIResponsesProviders || 0} OpenAI</span>
          <span>${providerCounts.anthropicMessageBatchesProviders || 0} Anthropic</span>
        </div>
        <button type="submit" ${mode === "api" ? "" : "disabled"}>Save Settings</button>
      </form>
    </details>
  `;
}

function renderValidationWarnings(warnings) {
  if (!warnings.length) return "";
  return `
    <div class="settings-warning">
      ${warnings.slice(0, 4).map((warning) => `<p>${escapeText(warning)}</p>`).join("")}
    </div>
  `;
}

function renderLocalAgentRows(agents, mode) {
  const rows = [...agents, { id: "", name: "", command: "", args: [], match: "", cwd: "." }];
  return rows.map((agent, index) => renderLocalAgentRow(agent, index, mode)).join("");
}

function renderLocalAgentRow(agent, index, mode) {
  const disabled = mode === "api" ? "" : "disabled";
  return `
    <fieldset class="remote-provider-row" data-local-agent-row>
      <input data-local-agent-field="id" value="${escapeAttribute(agent.id || "")}" ${disabled} aria-label="Local agent ID ${index + 1}" />
      <input data-local-agent-field="name" value="${escapeAttribute(agent.name || "")}" ${disabled} aria-label="Local agent name ${index + 1}" />
      <input data-local-agent-field="command" value="${escapeAttribute(agent.command || "")}" ${disabled} aria-label="Local agent command ${index + 1}" />
      <input data-local-agent-field="args" value="${escapeAttribute((agent.args || []).join(" "))}" ${disabled} aria-label="Local agent args ${index + 1}" />
      <input data-local-agent-field="match" value="${escapeAttribute(agent.match || agent.command || "")}" ${disabled} aria-label="Local agent match ${index + 1}" />
      <input data-local-agent-field="cwd" value="${escapeAttribute(agent.cwd || ".")}" ${disabled} aria-label="Local agent working directory ${index + 1}" />
      <input data-local-agent-field="env" type="password" value="" ${disabled} aria-label="Local agent env ${index + 1}" />
      <span>${agent.hasEnv ? "Env saved" : "No env"} · id | name | command | args | match | cwd</span>
    </fieldset>
  `;
}

function renderRemoteProviderRows(providers, mode) {
  const rows = [...providers, { id: "", label: "", baseUrl: "", source: "cloud", hasToken: false }];
  return rows.map((provider, index) => renderRemoteProviderRow(provider, index, mode)).join("");
}

function renderRemoteProviderRow(provider, index, mode) {
  const disabled = mode === "api" ? "" : "disabled";
  return `
    <fieldset class="remote-provider-row" data-remote-row>
      <input data-remote-field="id" value="${escapeAttribute(provider.id || "")}" ${disabled} aria-label="Remote provider ID ${index + 1}" />
      <input data-remote-field="label" value="${escapeAttribute(provider.label || "")}" ${disabled} aria-label="Remote provider label ${index + 1}" />
      <input data-remote-field="baseUrl" value="${escapeAttribute(provider.baseUrl || "")}" ${disabled} aria-label="Remote provider URL ${index + 1}" />
      <input data-remote-field="dashboardUrl" value="${escapeAttribute(provider.dashboardUrl || "")}" ${disabled} aria-label="Remote provider dashboard URL ${index + 1}" />
      <input data-remote-field="type" value="${escapeAttribute(provider.type || provider.id || "remote")}" ${disabled} aria-label="Remote provider type ${index + 1}" />
      <select data-remote-field="source" ${disabled} aria-label="Remote provider source ${index + 1}">
        ${["cloud", "user-account", "local"].map((source) => renderOption(source, provider.source || "cloud")).join("")}
      </select>
      <input data-remote-field="tokenHeader" value="${escapeAttribute(provider.tokenHeader || "Authorization")}" ${disabled} aria-label="Remote provider token header ${index + 1}" />
      <input data-remote-field="tokenPrefix" value="${escapeAttribute(provider.tokenPrefix ?? "Bearer")}" ${disabled} aria-label="Remote provider token prefix ${index + 1}" />
      <input data-remote-field="token" type="password" value="" ${disabled} aria-label="Remote provider token ${index + 1}" />
      <span>${provider.hasToken ? "Token saved" : "No token"} · auth defaults to Authorization: Bearer</span>
    </fieldset>
  `;
}

function renderOpenAIProviderRows(providers, mode) {
  const rows = [
    ...providers,
    { id: "", label: "", apiKeyEnv: "OPENAI_API_KEY", hasApiKey: false, responses: [] }
  ];
  return rows.map((provider, index) => renderOpenAIProviderRow(provider, index, mode)).join("");
}

function renderOpenAIProviderRow(provider, index, mode) {
  const disabled = mode === "api" ? "" : "disabled";
  return `
    <fieldset class="remote-provider-row" data-openai-row>
      <input data-openai-field="id" value="${escapeAttribute(provider.id || "")}" ${disabled} aria-label="OpenAI provider ID ${index + 1}" />
      <input data-openai-field="label" value="${escapeAttribute(provider.label || "")}" ${disabled} aria-label="OpenAI provider label ${index + 1}" />
      <input data-openai-field="apiKeyEnv" value="${escapeAttribute(provider.apiKeyEnv || "OPENAI_API_KEY")}" ${disabled} aria-label="OpenAI API key env ${index + 1}" />
      <input data-openai-field="apiKey" type="password" value="" ${disabled} aria-label="OpenAI API key ${index + 1}" />
      <input data-openai-field="organization" value="${escapeAttribute(provider.organization || "")}" ${disabled} aria-label="OpenAI organization ${index + 1}" />
      <input data-openai-field="project" value="${escapeAttribute(provider.project || "")}" ${disabled} aria-label="OpenAI project ${index + 1}" />
      <input data-openai-field="inputCostUsdPer1K" type="number" min="0" step="0.000001" value="${escapeAttribute(provider.inputCostUsdPer1K || 0)}" ${disabled} aria-label="OpenAI input cost per 1K tokens ${index + 1}" />
      <input data-openai-field="outputCostUsdPer1K" type="number" min="0" step="0.000001" value="${escapeAttribute(provider.outputCostUsdPer1K || 0)}" ${disabled} aria-label="OpenAI output cost per 1K tokens ${index + 1}" />
      <textarea data-openai-field="responses" rows="3" ${disabled} aria-label="OpenAI response list ${index + 1}">${escapeText(formatOpenAIResponseLines(provider.responses || []))}</textarea>
      <span>${provider.hasApiKey ? "API key saved" : "No API key"} · tracked: id | name | responseId | task | goToUrl · launch: id | name | model | input | goToUrl · optional cost rates are USD per 1K input/output tokens</span>
    </fieldset>
  `;
}

function renderAnthropicProviderRows(providers, mode) {
  const rows = [
    ...providers,
    { id: "", label: "", apiKeyEnv: "ANTHROPIC_API_KEY", hasApiKey: false, batches: [] }
  ];
  return rows.map((provider, index) => renderAnthropicProviderRow(provider, index, mode)).join("");
}

function renderAnthropicProviderRow(provider, index, mode) {
  const disabled = mode === "api" ? "" : "disabled";
  return `
    <fieldset class="remote-provider-row" data-anthropic-row>
      <input data-anthropic-field="id" value="${escapeAttribute(provider.id || "")}" ${disabled} aria-label="Anthropic provider ID ${index + 1}" />
      <input data-anthropic-field="label" value="${escapeAttribute(provider.label || "")}" ${disabled} aria-label="Anthropic provider label ${index + 1}" />
      <input data-anthropic-field="apiKeyEnv" value="${escapeAttribute(provider.apiKeyEnv || "ANTHROPIC_API_KEY")}" ${disabled} aria-label="Anthropic API key env ${index + 1}" />
      <input data-anthropic-field="apiKey" type="password" value="" ${disabled} aria-label="Anthropic API key ${index + 1}" />
      <input data-anthropic-field="version" value="${escapeAttribute(provider.version || "")}" ${disabled} aria-label="Anthropic version ${index + 1}" />
      <label class="toggle-row">
        <input data-anthropic-field="discoverRecent" type="checkbox" ${provider.discoverRecent ? "checked" : ""} ${disabled} />
        <span>Discover recent</span>
      </label>
      <input data-anthropic-field="discoverLimit" type="number" min="1" max="100" value="${escapeAttribute(provider.discoverLimit || 10)}" ${disabled} aria-label="Anthropic discovery limit ${index + 1}" />
      <input data-anthropic-field="dashboardUrl" value="${escapeAttribute(provider.dashboardUrl || "")}" ${disabled} aria-label="Anthropic dashboard URL ${index + 1}" />
      <textarea data-anthropic-field="batches" rows="3" ${disabled} aria-label="Anthropic batch list ${index + 1}">${escapeText(formatAnthropicBatchLines(provider.batches || []))}</textarea>
      <span>${provider.hasApiKey ? "API key saved" : "No API key"} · tracked: id | name | batchId | task | goToUrl · launch: id | name | model | input | goToUrl · discovery lists recent batches</span>
    </fieldset>
  `;
}

function renderOfficeView(agents, allAgents, providers, selectedAgentId, focusAgentId = null) {
  const selected = agents.find((agent) => agent.id === selectedAgentId) || allAgents.find((agent) => agent.id === selectedAgentId) || agents[0] || null;
  const focused = focusAgentId ? agents.find((agent) => agent.id === focusAgentId) || null : null;
  return `
    <section class="office-view" aria-label="Office view of agents">
      <div class="office-stage ${focused ? "focused" : ""}">
        <canvas class="office-canvas" width="1400" height="760" data-office-canvas aria-label="${focused ? "Focused agent cubicle" : "Agent office floor"}"></canvas>
        <div class="office-hud" aria-label="Office view status">
          <span>${focused ? "Cubicle Focus" : `${agents.length} cubicle${agents.length === 1 ? "" : "s"}`}</span>
          ${focused ? `<button type="button" data-office-floor>Floor</button>` : ""}
        </div>
        <div class="office-legend" aria-label="Office status legend">
          <span><i class="legend-dot good"></i>Running</span>
          <span><i class="legend-dot warn"></i>Waiting</span>
          <span><i class="legend-dot idle"></i>Idle</span>
        </div>
      </div>
      <aside class="office-inspector">
        ${selected ? renderOfficeInspector(selected, allAgents, providers, Boolean(focused)) : renderOfficeEmptyState()}
      </aside>
    </section>
  `;
}

function renderOfficeInspector(agent, agents, providers, focused = false) {
  const provider = providerForAgent(agent, providers);
  const parent = agent.parentId ? agents.find((item) => item.id === agent.parentId)?.name || agent.parentId : "Root";
  return `
    <div class="office-inspector-heading">
      <p class="eyebrow">${focused ? "Cubicle Focus" : "Selected Cubicle"}</p>
      <h3>${escapeText(agent.name)}</h3>
      <span class="status-pill ${escapeAttribute(statusTone(agent.status))}">${escapeText(agent.status)}</span>
    </div>
    <p class="office-inspector-subtitle">${escapeText(agent.provider)} · ${escapeText(labelize(agent.type || agent.providerId || agent.source))}</p>
    <div class="office-inspector-actions action-row">
      ${agentActions.map((action) => renderAction(agent, action)).join("")}
    </div>
    <div class="office-card-grid">
      <article>
        <span>Task</span>
        <strong>${escapeText(agent.task || "Untitled task")}</strong>
        <p>${escapeText(taskProgressLine(agent) || "No progress reported")}</p>
      </article>
      <article>
        <span>Context</span>
        <strong>${escapeText(agentContextTitle(agent))}</strong>
        <p>${escapeText(agentContextLine(agent) || "No context reported")}</p>
      </article>
      <article>
        <span>Resources</span>
        <strong>${formatMemory(agent.memoryMb)}</strong>
        <p>${escapeText(renderResourceLine(agent))}</p>
      </article>
      <article class="${provider?.status === "error" ? "detail-warning" : ""}">
        <span>Provider</span>
        <strong>${escapeText(provider ? labelize(provider.status) : "Unknown")}</strong>
        <p>${escapeText(providerHealthLine(agent, provider))}</p>
      </article>
      <article>
        <span>Lineage</span>
        <strong>${escapeText(parent)}</strong>
        <p>${escapeText(agent.children?.length ? `${agent.children.length} children` : "No children")}</p>
      </article>
      <article>
        <span>Usage</span>
        <strong>${formatTokenTotal(agent.tokens)} tokens</strong>
        <p>${escapeText(renderTokenUsageLine(agent))} · $${Number(agent.costUsd || 0).toFixed(2)}</p>
      </article>
    </div>
  `;
}

function renderOfficeEmptyState() {
  return `
    <div class="office-empty">
      <p class="eyebrow">Selected Cubicle</p>
      <h3>No agent selected</h3>
    </div>
  `;
}

function renderAgentTable(agents, allAgents, providers, selectedAgentId) {
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
    ${agents.map((agent) => renderAgentRow(agent, allAgents, providers, selectedAgentId)).join("")}
  `;
}

function renderAgentRow(agent, agents, providers, selectedAgentId) {
  const parent = agent.parentId ? agents.find((item) => item.id === agent.parentId)?.name || agent.parentId : "Root";
  const childCount = agent.children.length;
  const childNames = agent.children
    .map((childId) => agents.find((item) => item.id === childId)?.name || childId)
    .join(", ");
  const provider = providerForAgent(agent, providers);
  return `
    <article class="table-row ${agent.id === selectedAgentId ? "selected" : ""}" role="row">
      <div class="agent-name">
        <button class="agent-link" type="button" data-select-agent="${escapeAttribute(agent.id)}">${escapeText(agent.name)}</button>
        <p>${escapeText(agent.provider)} · ${escapeText(labelize(agent.type || agent.providerId || agent.source))} · ${escapeText(agent.task)}</p>
        ${renderAgentHealthLine(agent, provider)}
        ${renderTaskProgress(agent)}
      </div>
      <div>
        <span class="status-pill ${escapeAttribute(statusTone(agent.status))}">${escapeText(agent.status)}</span>
        <p class="muted">${formatRuntime(agent)}</p>
      </div>
      <div class="resource-stack">
        <meter min="0" max="100" value="${agent.cpu}"></meter>
        <p>${escapeText(renderResourceLine(agent))}</p>
      </div>
      <div>
        <p>${escapeText(parent)}</p>
        <p class="muted">${childCount ? escapeText(childNames) : "No children"}</p>
      </div>
      <div class="action-row">
        ${agentActions.map((action) => renderAction(agent, action)).join("")}
      </div>
    </article>
  `;
}

function renderDetailPanel(detail, providers = []) {
  if (!detail?.agent) return "";

  const { agent, history, lineage } = detail;
  const provider = providerForAgent(agent, providers);
  return `
    <details class="detail-panel">
      <summary class="detail-heading">
        <div class="detail-title">
          <p class="eyebrow">Selected Agent</p>
          <h2>${escapeText(agent.name)}</h2>
          <p>${escapeText(agent.provider)} · ${escapeText(labelize(agent.type || agent.providerId || agent.source))}</p>
        </div>
        <div class="detail-controls">
          <span class="status-pill ${escapeAttribute(statusTone(agent.status))}">${escapeText(agent.status)}</span>
        </div>
      </summary>
      <div class="action-row detail-action-row">
        ${agentActions.map((action) => renderAction(agent, action)).join("")}
      </div>
      <div class="detail-grid">
        <article>
          <span>Task</span>
          <strong>${escapeText(agent.task || "Untitled task")}</strong>
          <p>${escapeText(taskProgressLine(agent) || "No progress reported")}</p>
        </article>
        <article>
          <span>Context</span>
          <strong>${escapeText(agentContextTitle(agent))}</strong>
          <p>${escapeText(agentContextLine(agent) || "No context reported")}</p>
        </article>
        <article>
          <span>Provider</span>
          <strong>${escapeText(agent.provider)}</strong>
          <p>${escapeText(labelize(agent.type || agent.providerId || "unknown"))} · ${escapeText(agent.providerId || agent.source || "unknown")}</p>
        </article>
        <article>
          <span>Provider Object</span>
          <strong>${escapeText(providerObjectTitle(agent))}</strong>
          <p>${escapeText(providerObjectLine(agent))}</p>
        </article>
        <article class="${provider?.status === "error" ? "detail-warning" : ""}">
          <span>Provider Health</span>
          <strong>${escapeText(provider ? labelize(provider.status) : "Unknown")}</strong>
          <p>${escapeText(providerHealthLine(agent, provider))}</p>
        </article>
        <article>
          <span>Runtime</span>
          <strong>${formatRuntime(agent)}</strong>
          <p>${formatTimestamp(agent.startedAt)}</p>
        </article>
        <article>
          <span>Resources</span>
          <strong>${formatMemory(agent.memoryMb)}</strong>
          <p>${escapeText(renderProcessLine(agent))}</p>
        </article>
        <article>
          <span>Usage</span>
          <strong>${agent.tokens ? agent.tokens.toLocaleString() : 0} tokens</strong>
          <p>${escapeText(renderTokenUsageLine(agent))} · $${Number(agent.costUsd || 0).toFixed(2)}</p>
        </article>
      </div>
      <div class="detail-columns">
        <article>
          <h3>Lineage</h3>
          <p><strong>Parent:</strong> ${escapeText(lineage.parentLabel)}</p>
          <p><strong>Children:</strong> ${escapeText(lineage.childrenLabel)}</p>
        </article>
        <article>
          <h3>Recent Actions</h3>
          ${history.length ? history.slice(0, 4).map(renderDetailHistory).join("") : "<p>No actions recorded.</p>"}
        </article>
        <article>
          <h3>Logs</h3>
          ${renderAgentLogs(agent)}
        </article>
        <article>
          <h3>Transcript</h3>
          ${renderAgentTranscript(agent)}
        </article>
      </div>
    </details>
  `;
}

function renderAgentLogs(agent) {
  const logs = Array.isArray(agent.logs) ? agent.logs : [];
  if (!logs.length) return "<p>No logs reported.</p>";

  return logs
    .slice(0, 5)
    .map(
      (log) => `
        <p class="log-line ${escapeAttribute(log.level || "info")}">
          <strong>${escapeText(log.source || "agent")}</strong>
          <span>${formatTimestamp(log.at)} · ${escapeText(log.message)}</span>
        </p>
      `
    )
    .join("");
}

function providerObjectTitle(agent) {
  return agent.remoteId || agent.pid || agent.model || "No remote ID";
}

function providerObjectLine(agent) {
  const parts = [];
  if (agent.model) parts.push(`model ${agent.model}`);
  if (agent.requestCounts && typeof agent.requestCounts === "object") {
    const requestLine = Object.entries(agent.requestCounts)
      .filter(([, value]) => Number(value || 0) > 0)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ");
    if (requestLine) parts.push(requestLine);
  }
  if (agent.windowTitle) parts.push(agent.windowTitle);
  if (agent.goToKind && agent.goToKind !== "unknown") parts.push(`go-to ${agent.goToKind}`);
  return parts.join(" · ") || "No provider object details";
}

function renderAgentTranscript(agent) {
  const transcript = Array.isArray(agent.transcript) ? agent.transcript : [];
  if (!transcript.length) return "<p>No transcript reported.</p>";

  return transcript
    .slice(-6)
    .map(
      (entry) => `
        <p class="log-line ${escapeAttribute(entry.role || "assistant")}">
          <strong>${escapeText(labelize(entry.role || "assistant"))}</strong>
          <span>${formatTimestamp(entry.at)} · ${escapeText(entry.content)}</span>
        </p>
      `
    )
    .join("");
}

function providerForAgent(agent, providers) {
  return providers.find((provider) => provider.id === agent.providerId) || null;
}

function renderAgentHealthLine(agent, provider) {
  const line = providerHealthLine(agent, provider);
  if (!line) return "";
  const status = provider?.status === "error" ? "warn" : "info";
  return `<p class="health-line ${status}">${escapeText(line)}</p>`;
}

function providerHealthLine(agent, provider) {
  const freshness = formatScanFreshness([{ scannedAt: agent.scannedAt || provider?.scannedAt }]);
  if (provider?.status === "error") {
    return `${provider.error || "Provider error"} · ${freshness}`;
  }
  if (provider) {
    return `${labelize(provider.status)} · ${freshness}`;
  }
  return freshness;
}

function renderDetailHistory(record) {
  return `
    <p>
      <strong>${escapeText(record.label)} · ${escapeText(actionKindLabel(record))}</strong>
      <span>${formatTimestamp(record.at)}${record.prompt ? ` · ${escapeText(record.prompt)}` : ""}</span>
    </p>
  `;
}

function buildDetail(agentId, agents, history) {
  const agent = agents.find((item) => item.id === agentId);
  if (!agent) return null;

  const parent = agent.parentId ? agents.find((item) => item.id === agent.parentId) || null : null;
  const children = agent.children
    .map((childId) => agents.find((item) => item.id === childId))
    .filter(Boolean);
  const childLabels = agent.children.map((childId) => agents.find((item) => item.id === childId)?.name || childId);

  return {
    agent,
    parent,
    children,
    lineage: {
      parentLabel: parent?.name || agent.parentId || "Root",
      childrenLabel: childLabels.length ? childLabels.join(", ") : "None"
    },
    history: history.filter((record) => record.agentId === agentId)
  };
}

function drawOfficeView(canvas, agents, selectedAgentId, focusAgentId = null) {
  const context = canvas.getContext("2d");
  if (!context) return [];

  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  drawOfficeFloor(context, width, height);

  if (!agents.length) {
    context.fillStyle = "#667085";
    context.font = "700 30px Inter, sans-serif";
    context.textAlign = "center";
    context.fillText("No agents match the current filters", width / 2, height / 2);
    return [];
  }

  const focusedAgent = focusAgentId ? agents.find((agent) => agent.id === focusAgentId) : null;
  if (focusedAgent) {
    drawFocusedCubicle(context, focusedAgent, width, height);
    return [];
  }

  const hitBoxes = officeCubicleLayout(agents, width, height);
  drawOfficeAisles(context, hitBoxes, width, height);
  hitBoxes.forEach((box) => drawCubicle(context, box, box.agent.id === selectedAgentId));
  return hitBoxes;
}

function drawOfficeFloor(context, width, height) {
  const tile = 38;
  context.fillStyle = "#ece7dc";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "rgba(99, 83, 58, 0.12)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += tile) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += tile) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.fillStyle = "rgba(255, 255, 255, 0.34)";
  context.beginPath();
  context.moveTo(48, 44);
  context.lineTo(width - 80, 24);
  context.lineTo(width - 34, 84);
  context.lineTo(70, 118);
  context.closePath();
  context.fill();
}

function drawOfficeAisles(context, hitBoxes, width, height) {
  if (!hitBoxes.length) return;
  context.fillStyle = "rgba(255, 255, 255, 0.45)";
  const rows = [...new Set(hitBoxes.map((box) => box.row))];
  rows.forEach((row) => {
    const rowBoxes = hitBoxes.filter((box) => box.row === row);
    const y = Math.min(...rowBoxes.map((box) => box.y)) - 16;
    context.fillRect(0, y, width, 16);
  });
  context.fillRect(width - 92, 0, 40, height);
}

function drawCubicle(context, box, selected) {
  const { agent, x, y, width, height } = box;
  const tone = officeTone(agent);
  const wall = selected ? "#23395d" : "#7d8796";
  const accent = tone.accent;
  const deskY = y + height * 0.52;

  context.save();
  context.shadowColor = selected ? "rgba(35, 57, 93, 0.28)" : "rgba(33, 41, 54, 0.14)";
  context.shadowBlur = selected ? 18 : 8;
  context.shadowOffsetY = 4;
  context.fillStyle = tone.floor;
  roundedRect(context, x, y, width, height, 8);
  context.fill();
  context.restore();

  context.strokeStyle = wall;
  context.lineWidth = selected ? 5 : 3;
  context.beginPath();
  context.moveTo(x, y + height);
  context.lineTo(x, y);
  context.lineTo(x + width, y);
  context.lineTo(x + width, y + height * 0.58);
  context.stroke();

  context.fillStyle = "#b98958";
  roundedRect(context, x + 18, deskY, width - 36, 20, 4);
  context.fill();
  context.fillStyle = "#8d5f38";
  context.fillRect(x + 18, deskY + 16, width - 36, 8);

  context.fillStyle = "#46556a";
  roundedRect(context, x + width * 0.56, deskY - 34, 34, 22, 3);
  context.fill();
  context.fillStyle = accent;
  context.fillRect(x + width * 0.56 + 5, deskY - 29, 24, 12);

  context.fillStyle = "#3f4652";
  roundedRect(context, x + width * 0.28, deskY - 24, 28, 28, 7);
  context.fill();
  context.fillStyle = accent;
  context.beginPath();
  context.arc(x + width * 0.28 + 14, deskY - 34, 14, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.42)";
  context.beginPath();
  context.moveTo(x + width * 0.28 + 10, deskY - 46);
  context.lineTo(x + width * 0.28 + 22, deskY - 38);
  context.lineTo(x + width * 0.28 + 12, deskY - 31);
  context.closePath();
  context.fill();

  context.fillStyle = selected ? "#172033" : "#344054";
  context.font = "800 19px Inter, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "top";
  clippedText(context, agent.name, x + 14, y + 13, width - 28);

  context.fillStyle = "#667085";
  context.font = "700 14px Inter, sans-serif";
  clippedText(context, `${labelize(agent.status)} · ${formatMemory(agent.memoryMb)}`, x + 14, y + 39, width - 28);

  context.fillStyle = accent;
  roundedRect(context, x + width - 34, y + height - 32, 18, 18, 9);
  context.fill();
}

function drawFocusedCubicle(context, agent, width, height) {
  const tone = officeTone(agent);
  const room = {
    x: 92,
    y: 70,
    width: width - 184,
    height: height - 128
  };
  const desk = {
    x: room.x + room.width * 0.16,
    y: room.y + room.height * 0.57,
    width: room.width * 0.68,
    height: 70
  };

  context.save();
  context.fillStyle = tone.floor;
  roundedRect(context, room.x, room.y, room.width, room.height, 18);
  context.fill();
  context.restore();

  context.strokeStyle = "#596273";
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(room.x, room.y + room.height);
  context.lineTo(room.x, room.y);
  context.lineTo(room.x + room.width, room.y);
  context.lineTo(room.x + room.width, room.y + room.height * 0.64);
  context.stroke();

  drawWallPanels(context, room, tone);
  drawFocusedDesk(context, desk, tone);
  drawFocusedAgent(context, room, desk, tone);
  drawFocusedContextBoard(context, agent, room, tone);
  drawFocusedComms(context, agent, room, tone);

  context.fillStyle = "#172033";
  context.font = "900 38px Inter, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "top";
  clippedText(context, agent.name, room.x + 34, room.y + 28, room.width * 0.56);

  context.fillStyle = "#475467";
  context.font = "700 20px Inter, sans-serif";
  clippedText(context, `${agent.provider} · ${labelize(agent.type || agent.providerId || agent.source)} · ${labelize(agent.status)}`, room.x + 36, room.y + 78, room.width * 0.58);
}

function drawWallPanels(context, room, tone) {
  const panelY = room.y + 130;
  context.fillStyle = "rgba(255, 255, 255, 0.38)";
  roundedRect(context, room.x + 34, panelY, room.width * 0.28, 132, 8);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.32)";
  roundedRect(context, room.x + room.width * 0.39, panelY + 12, room.width * 0.2, 74, 7);
  context.fill();
  context.fillStyle = tone.accent;
  roundedRect(context, room.x + room.width * 0.62, panelY + 2, 22, 22, 11);
  context.fill();
  context.fillStyle = "rgba(23, 32, 51, 0.12)";
  for (let index = 0; index < 4; index += 1) {
    context.fillRect(room.x + 56, panelY + 28 + index * 24, room.width * 0.22, 5);
  }
}

function drawFocusedDesk(context, desk, tone) {
  context.fillStyle = "#b98958";
  roundedRect(context, desk.x, desk.y, desk.width, desk.height, 8);
  context.fill();
  context.fillStyle = "#8d5f38";
  context.fillRect(desk.x, desk.y + desk.height - 18, desk.width, 18);

  const screenX = desk.x + desk.width * 0.58;
  context.fillStyle = "#263143";
  roundedRect(context, screenX, desk.y - 96, 150, 92, 8);
  context.fill();
  context.fillStyle = "#d9f7e6";
  roundedRect(context, screenX + 12, desk.y - 84, 126, 64, 5);
  context.fill();
  context.fillStyle = tone.accent;
  context.fillRect(screenX + 24, desk.y - 70, 78, 7);
  context.fillStyle = "#7d8796";
  context.fillRect(screenX + 38, desk.y - 53, 58, 6);
  context.fillRect(screenX + 38, desk.y - 38, 82, 6);
  context.fillStyle = "#263143";
  context.fillRect(screenX + 70, desk.y - 4, 20, 28);
  context.fillRect(screenX + 48, desk.y + 20, 64, 8);

  context.fillStyle = "#f4d7aa";
  roundedRect(context, desk.x + 72, desk.y - 34, 64, 42, 6);
  context.fill();
  context.fillStyle = "#475467";
  context.fillRect(desk.x + 84, desk.y - 20, 38, 5);
  context.fillRect(desk.x + 84, desk.y - 7, 28, 5);
}

function drawFocusedAgent(context, room, desk, tone) {
  const centerX = desk.x + desk.width * 0.36;
  const centerY = desk.y - 42;

  context.fillStyle = "#3f4652";
  roundedRect(context, centerX - 35, centerY + 32, 70, 82, 12);
  context.fill();
  context.fillStyle = tone.accent;
  context.beginPath();
  context.arc(centerX, centerY, 42, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.45)";
  context.beginPath();
  context.moveTo(centerX - 14, centerY - 30);
  context.lineTo(centerX + 28, centerY - 8);
  context.lineTo(centerX - 8, centerY + 18);
  context.closePath();
  context.fill();
  context.fillStyle = "#263143";
  roundedRect(context, centerX - 50, centerY + 116, 100, 26, 13);
  context.fill();

  context.fillStyle = "rgba(23, 32, 51, 0.1)";
  context.beginPath();
  context.ellipse(room.x + room.width * 0.5, room.y + room.height - 44, room.width * 0.28, 22, 0, 0, Math.PI * 2);
  context.fill();
}

function drawFocusedContextBoard(context, agent, room, tone) {
  const x = room.x + room.width - 360;
  const y = room.y + 42;
  context.fillStyle = "#ffffff";
  roundedRect(context, x, y, 300, 210, 10);
  context.fill();
  context.strokeStyle = "rgba(89, 98, 115, 0.28)";
  context.lineWidth = 2;
  roundedRect(context, x, y, 300, 210, 10);
  context.stroke();

  context.fillStyle = "#172033";
  context.font = "900 20px Inter, sans-serif";
  context.fillText("Context", x + 20, y + 20);
  context.fillStyle = tone.accent;
  context.fillRect(x + 20, y + 52, 84, 7);

  const lines = [
    agentContextTitle(agent),
    agentContextLine(agent) || "No context reported",
    taskProgressLine(agent) || agent.task || "No progress reported",
    renderTokenUsageLine(agent)
  ].filter(Boolean);
  context.fillStyle = "#475467";
  context.font = "700 15px Inter, sans-serif";
  lines.slice(0, 5).forEach((line, index) => {
    clippedText(context, line, x + 20, y + 76 + index * 28, 260);
  });
}

function drawFocusedComms(context, agent, room, tone) {
  const x = room.x + room.width - 360;
  const y = room.y + 284;
  context.fillStyle = "#ffffff";
  roundedRect(context, x, y, 300, 142, 10);
  context.fill();
  context.strokeStyle = "rgba(89, 98, 115, 0.28)";
  context.lineWidth = 2;
  roundedRect(context, x, y, 300, 142, 10);
  context.stroke();

  context.fillStyle = "#172033";
  context.font = "900 20px Inter, sans-serif";
  context.fillText("Signals", x + 20, y + 18);
  const childCount = Array.isArray(agent.children) ? agent.children.length : 0;
  const nodes = [
    { label: agent.parentId ? "parent" : "root", active: Boolean(agent.parentId) },
    { label: `${childCount} child${childCount === 1 ? "" : "ren"}`, active: childCount > 0 },
    { label: agent.goToKind || "surface", active: Boolean(agent.goToTarget) }
  ];
  nodes.forEach((node, index) => {
    const cx = x + 58 + index * 88;
    const cy = y + 82;
    context.strokeStyle = index ? "rgba(89, 98, 115, 0.32)" : "transparent";
    context.lineWidth = 3;
    if (index) {
      context.beginPath();
      context.moveTo(cx - 66, cy);
      context.lineTo(cx - 20, cy);
      context.stroke();
    }
    context.fillStyle = node.active ? tone.accent : "#cbd2dd";
    roundedRect(context, cx - 18, cy - 18, 36, 36, 18);
    context.fill();
    context.fillStyle = "#475467";
    context.font = "700 12px Inter, sans-serif";
    context.textAlign = "left";
    clippedText(context, node.label, cx - 36, cy + 28, 72);
  });
}

function officeCubicleLayout(agents, width, height) {
  const count = Math.max(1, agents.length);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * (width / Math.max(height, 1)))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const padding = 44;
  const gap = Math.max(14, Math.min(30, 32 - Math.max(0, count - 8)));
  const cellWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const cellHeight = (height - padding * 2 - gap * (rows - 1)) / rows;
  const cubicleWidth = Math.max(116, Math.min(250, cellWidth));
  const cubicleHeight = Math.max(96, Math.min(165, cellHeight));

  return agents.map((agent, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cellX = padding + column * (cellWidth + gap);
    const cellY = padding + row * (cellHeight + gap);
    return {
      agent,
      row,
      column,
      x: cellX + Math.max(0, (cellWidth - cubicleWidth) / 2),
      y: cellY + Math.max(0, (cellHeight - cubicleHeight) / 2),
      width: cubicleWidth,
      height: cubicleHeight
    };
  });
}

function officeHitTest(canvas, hitBoxes, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(rect.width, 1);
  const scaleY = canvas.height / Math.max(rect.height, 1);
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;
  return hitBoxes.find((box) => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) || null;
}

function officeTone(agent) {
  const tone = statusTone(agent.status);
  const tones = {
    good: { floor: "#e3f5e9", accent: "#2f8f51" },
    warn: { floor: "#fff0ca", accent: "#c47a13" },
    done: { floor: "#e7edf5", accent: "#4f6f9d" },
    idle: { floor: "#edf1f5", accent: "#667085" }
  };
  return tones[tone] || tones.idle;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function clippedText(context, text, x, y, maxWidth) {
  const value = String(text || "");
  if (context.measureText(value).width <= maxWidth) {
    context.fillText(value, x, y);
    return;
  }
  let clipped = value;
  while (clipped.length > 1 && context.measureText(`${clipped}...`).width > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  context.fillText(`${clipped}...`, x, y);
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
        <strong>${escapeText(agent.name)}</strong>
        <p>${escapeText(agent.provider)} · ${escapeText(agent.status)}</p>
      </div>
      <span>${children.length}</span>
    </article>
    ${children.map((child) => renderLineageNode(child, agents, depth + 1)).join("")}
  `;
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
  return parts.join(" · ");
}

function renderTaskProgress(agent) {
  if (!agent.currentStep && !Number.isFinite(Number(agent.progressPercent))) return "";
  return `<p class="muted">${escapeText(taskProgressLine(agent))}</p>`;
}

function taskProgressLine(agent) {
  return [
    Number.isFinite(Number(agent.progressPercent)) ? `${Number(agent.progressPercent)}%` : "",
    agent.currentStep || ""
  ].filter(Boolean).join(" · ");
}

function agentContextTitle(agent) {
  return agent.workspace || agent.repository || agent.windowTitle || agent.queue || "Agent context";
}

function agentContextLine(agent) {
  return [
    agent.owner ? `owner ${agent.owner}` : "",
    agent.repository && agent.branch ? `${agent.repository}@${agent.branch}` : agent.branch || "",
    agent.queue ? `queue ${agent.queue}` : "",
    agent.priority ? `priority ${agent.priority}` : "",
    agent.remoteUrl || agent.goToTarget || ""
  ].filter(Boolean).join(" · ");
}

function renderTokenUsageLine(agent) {
  const parts = [];
  const rate = formatTokenRate(agent);
  if (rate) parts.push(rate);
  parts.push(`${labelize(agent.tokenCountConfidence || "unknown")} count`);
  if (agent.tokenRateWindowMs) parts.push(`${Math.round(agent.tokenRateWindowMs / 1000)}s window`);
  return parts.join(" · ");
}

function renderProcessLine(agent) {
  const parts = [`${agent.cpu}% CPU`];
  if (agent.processCpu || agent.processMemoryMb) {
    parts.push(`own ${Number(agent.processCpu || 0)}% / ${formatMemory(Number(agent.processMemoryMb || 0))}`);
  }
  if (agent.childCpu || agent.childMemoryMb) {
    parts.push(`children ${Number(agent.childCpu || 0)}% / ${formatMemory(Number(agent.childMemoryMb || 0))}`);
  }
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
      searchableAgentFields(agent).some((value) => String(value).toLowerCase().includes(query));
    const matchesStatus = filters.status === "all" || agent.status === filters.status;
    const matchesSource = filters.source === "all" || agent.source === filters.source;
    const matchesType = filters.type === "all" || (agent.type || agent.providerId || agent.source) === filters.type;
    const matchesProvider = (filters.provider || "all") === "all" || agent.providerId === filters.provider;
    return matchesQuery && matchesStatus && matchesSource && matchesType && matchesProvider;
  }).sort((a, b) => compareAgents(a, b, filters.sort || "started-desc"));
}

function agentProviderOptions(agents) {
  const seen = new Map();
  for (const agent of agents) {
    const id = agent.providerId || agent.provider || agent.source;
    if (!id || seen.has(id)) continue;
    seen.set(id, {
      id,
      label: [agent.provider, id].filter(Boolean).filter(unique).join(" · ")
    });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function searchableAgentFields(agent) {
  return [
    agent.name,
    agent.provider,
    agent.task,
    agent.currentStep,
    agent.owner,
    agent.workspace,
    agent.repository,
    agent.branch,
    agent.queue,
    agent.priority,
    agent.id,
    agent.providerId,
    agent.source,
    agent.type,
    agent.remoteId,
    agent.model,
    ...requestCountFields(agent),
    agent.windowTitle,
    agent.goToTarget
  ].filter(Boolean);
}

function requestCountFields(agent) {
  if (!agent.requestCounts || typeof agent.requestCounts !== "object") return [];
  return Object.entries(agent.requestCounts).flatMap(([key, value]) => [key, `${key} ${value}`, value]);
}

function compareAgents(a, b, sort) {
  const runtime = (agent) => Number((agent.endedAt || Date.now()) - agent.startedAt || 0);
  const priority = (agent) => ({ urgent: 4, high: 3, medium: 2, normal: 1, low: 0 })[String(agent.priority || "").toLowerCase()] ?? -1;
  const comparisons = {
    "started-desc": () => Number(b.startedAt || 0) - Number(a.startedAt || 0),
    "cpu-desc": () => Number(b.cpu || 0) - Number(a.cpu || 0),
    "memory-desc": () => Number(b.memoryMb || 0) - Number(a.memoryMb || 0),
    "spend-desc": () => Number(b.costUsd || 0) - Number(a.costUsd || 0),
    "tokens-desc": () => Number(b.tokens || 0) - Number(a.tokens || 0),
    "runtime-desc": () => runtime(b) - runtime(a),
    "priority-desc": () => priority(b) - priority(a),
    "status-asc": () => statusRank(b) - statusRank(a)
  };
  return (comparisons[sort]?.() || 0) || String(a.name || "").localeCompare(String(b.name || ""));
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

function renderOption(value, selected, label = labelize(value)) {
  return `<option value="${escapeAttribute(value)}" ${value === selected ? "selected" : ""}>${escapeText(label)}</option>`;
}

function escapeAttribute(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function escapeText(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function parseLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitShellWords(value) {
  const matches = String(value || "").match(/"([^"]*)"|'([^']*)'|\S+/g) || [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ""));
}

function parseRemoteProviders(form) {
  return [...form.querySelectorAll("[data-remote-row]")]
    .map((row) => {
      const fields = Object.fromEntries(
        [...row.querySelectorAll("[data-remote-field]")].map((input) => [
          input.getAttribute("data-remote-field"),
          input.value.trim()
        ])
      );

      return {
        id: fields.id,
        label: fields.label,
        baseUrl: fields.baseUrl,
        ...(fields.dashboardUrl ? { dashboardUrl: fields.dashboardUrl } : {}),
        type: fields.type || fields.id,
        source: fields.source || "cloud",
        tokenHeader: fields.tokenHeader || "Authorization",
        tokenPrefix: fields.tokenPrefix ?? "Bearer",
        ...(fields.token ? { token: fields.token } : {})
      };
    })
    .filter((provider) => provider.id && provider.baseUrl);
}

function parseLocalAgents(form) {
  return [...form.querySelectorAll("[data-local-agent-row]")]
    .map((row) => {
      const fields = rowFields(row, "local-agent");
      return {
        id: fields.id,
        name: fields.name,
        command: fields.command,
        args: splitShellWords(fields.args),
        match: fields.match || fields.command,
        cwd: fields.cwd || ".",
        ...(fields.env ? { env: fields.env.split("\n") } : {})
      };
    })
    .filter((agent) => agent.id && agent.name && agent.command);
}

function parseOpenAIProviders(form) {
  return [...form.querySelectorAll("[data-openai-row]")]
    .map((row) => {
      const fields = rowFields(row, "openai");
      return {
        id: fields.id,
        label: fields.label,
        apiKeyEnv: fields.apiKeyEnv || "OPENAI_API_KEY",
        ...(fields.apiKey ? { apiKey: fields.apiKey } : {}),
        ...(fields.organization ? { organization: fields.organization } : {}),
        ...(fields.project ? { project: fields.project } : {}),
        inputCostUsdPer1K: Number(fields.inputCostUsdPer1K || 0),
        outputCostUsdPer1K: Number(fields.outputCostUsdPer1K || 0),
        responses: parseOpenAIResponseLines(fields.responses)
      };
    })
    .filter((provider) => provider.id && provider.responses.length);
}

function parseAnthropicProviders(form) {
  return [...form.querySelectorAll("[data-anthropic-row]")]
    .map((row) => {
      const fields = rowFields(row, "anthropic");
      return {
        id: fields.id,
        label: fields.label,
        apiKeyEnv: fields.apiKeyEnv || "ANTHROPIC_API_KEY",
        ...(fields.apiKey ? { apiKey: fields.apiKey } : {}),
        ...(fields.version ? { version: fields.version } : {}),
        discoverRecent: fields.discoverRecent === true,
        discoverLimit: Number(fields.discoverLimit || 10),
        ...(fields.dashboardUrl ? { dashboardUrl: fields.dashboardUrl } : {}),
        batches: parseAnthropicBatchLines(fields.batches)
      };
    })
    .filter((provider) => provider.id && (provider.discoverRecent || provider.batches.length));
}

function rowFields(row, prefix) {
  return Object.fromEntries(
    [...row.querySelectorAll(`[data-${prefix}-field]`)].map((input) => [
      input.getAttribute(`data-${prefix}-field`),
      input.type === "checkbox" ? input.checked : input.value.trim()
    ])
  );
}

function parseTrackedLines(value, remoteIdKey) {
  return parseLines(value)
    .map((line) => {
      const [id, name, remoteId, task, goToTarget] = line.split("|").map((part) => part.trim());
      return {
        id,
        name,
        [remoteIdKey]: remoteId,
        task,
        ...(goToTarget ? { goToTarget, goToKind: "url" } : {})
      };
    })
    .filter((item) => item.id && item[remoteIdKey]);
}

function parseOpenAIResponseLines(value) {
  return parseLines(value)
    .map((line) => {
      const [id = "", name = "", third = "", fourth = "", goToTarget = ""] = line.split("|").map((part) => part.trim());
      if (third.startsWith("resp_")) {
        return {
          id,
          name,
          responseId: third,
          task: fourth,
          ...(goToTarget ? { goToTarget, goToKind: "url" } : {})
        };
      }

      return {
        id,
        name,
        model: third,
        input: fourth,
        task: fourth || name || id,
        ...(goToTarget ? { goToTarget, goToKind: "url" } : {})
      };
    })
    .filter((item) => item.id && (item.responseId || (item.model && item.input)));
}

function parseAnthropicBatchLines(value) {
  return parseLines(value)
    .map((line) => {
      const [id = "", name = "", third = "", fourth = "", goToTarget = ""] = line.split("|").map((part) => part.trim());
      if (third.startsWith("msgbatch_")) {
        return {
          id,
          name,
          batchId: third,
          task: fourth,
          ...(goToTarget ? { goToTarget, goToKind: "url" } : {})
        };
      }

      return {
        id,
        name,
        model: third,
        input: fourth,
        task: fourth || name || id,
        ...(goToTarget ? { goToTarget, goToKind: "url" } : {})
      };
    })
    .filter((item) => item.id && (item.batchId || (item.model && item.input)));
}

function formatTrackedLines(items, remoteIdKey) {
  return (Array.isArray(items) ? items : [])
    .map((item) => [
      item.id || "",
      item.name || "",
      item[remoteIdKey] || "",
      item.task || "",
      item.goToTarget || ""
    ].join(" | "))
    .join("\n");
}

function formatOpenAIResponseLines(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => [
      item.id || "",
      item.name || "",
      item.responseId || item.model || "",
      item.responseId ? item.task || "" : item.input || item.task || "",
      item.goToTarget || ""
    ].join(" | "))
    .join("\n");
}

function formatAnthropicBatchLines(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => [
      item.id || "",
      item.name || "",
      item.batchId || item.model || "",
      item.batchId ? item.task || "" : item.input || item.task || "",
      item.goToTarget || ""
    ].join(" | "))
    .join("\n");
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

function labelize(value) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unique(value, index, values) {
  return values.indexOf(value) === index;
}

function formatCpu(cpu) {
  const value = Number(cpu || 0);
  if (!Number.isFinite(value)) return "0%";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function formatTokenTotal(tokens) {
  const value = Number(tokens || 0);
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString();
}

function formatTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSeconds(milliseconds) {
  const seconds = Number(milliseconds) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return "3s";
  return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

function formatScanFreshness(items) {
  const scannedAt = Math.max(
    0,
    ...items
      .map((item) => Number(item.scannedAt || 0))
      .filter(Boolean)
  );
  if (!scannedAt) return "not scanned";
  const seconds = Math.max(0, Math.round((Date.now() - scannedAt) / 1000));
  if (seconds < 5) return "scanned now";
  if (seconds < 60) return `scanned ${seconds}s ago`;
  return `scanned ${Math.round(seconds / 60)}m ago`;
}

customElements.define("agent-monitor-app", AgentMonitorApp);
