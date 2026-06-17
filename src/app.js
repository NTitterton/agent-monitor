import {
  formatTokenRate,
  formatMemory,
  formatRuntime,
  agentActions,
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
      this.actionMessage = snapshot.actionMessage;
      this.mode = snapshot.mode;
      this.selectedAgentId = this.selectedAgentId || snapshot.agents[0]?.id || null;
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
    const intervalMs = Number(refresh.intervalMs || 15000);
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
    const filters = this.filters || { query: "", status: "all", source: "all", type: "all" };
    const filteredAgents = filterAgents(agents, filters);
    const running = agents.filter((agent) => agent.status === "running").length;
    const memory = agents.reduce((total, agent) => total + agent.memoryMb, 0);
    const spend = agents.reduce((total, agent) => total + agent.costUsd, 0);
    const history = this.history || [];
    const selectedDetail = this.detail || buildDetail(this.selectedAgentId, agents, history);
    const sources = [...new Set(agents.map((agent) => agent.source))].sort();
    const types = [...new Set(agents.map((agent) => agent.type || agent.providerId || agent.source))].sort();

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
            ${renderScannerStatus(this.scanner)}
            ${renderSourceList(agents, this.providers || [], this.providerTestMessage)}
            ${renderSettings(this.config, this.mode, this.settingsMessage)}
            ${renderLineageTree(agents)}
            ${renderHistory(history, this.mode)}
          </aside>
          <section class="panel agent-panel">
            <div class="panel-heading">
              <h2>Agent Tasks</h2>
              <button class="icon-button" type="button" title="Refresh snapshots" data-refresh>↻</button>
            </div>
            ${renderFilters(filters, sources, types)}
            ${renderActionMessage(this.actionMessage)}
            <div class="agent-table" role="table" aria-label="Agent task table">
              ${renderAgentTable(filteredAgents, agents, this.selectedAgentId)}
            </div>
            ${renderDetailPanel(selectedDetail)}
          </section>
        </section>
      </main>
    `;

    this.querySelector("[data-refresh]")?.addEventListener("click", () => client.refresh());
    this.querySelectorAll("[data-test-provider]").forEach((button) => {
      button.addEventListener("click", async () => {
        const providerId = button.getAttribute("data-test-provider");
        try {
          const provider = await client.testProvider(providerId);
          this.providerTestMessage = provider
            ? `${provider.label}: ${provider.status}${provider.error ? ` (${provider.error})` : ""}`
            : "Provider unavailable";
        } catch {
          this.providerTestMessage = "Provider test failed";
        }
        this.render();
      });
    });
    this.querySelector(".settings-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const patch = {
        allowedOrigins: parseLines(form.querySelector('[data-setting="allowedOrigins"]').value),
        localDiscovery: {
          enabled: form.querySelector('[data-setting="localDiscoveryEnabled"]').checked,
          include: parseLines(form.querySelector('[data-setting="localDiscoveryInclude"]').value),
          exclude: parseLines(form.querySelector('[data-setting="localDiscoveryExclude"]').value)
        },
        localAgents: parseLocalAgents(form),
        snapshotRefresh: {
          enabled: form.querySelector('[data-setting="snapshotRefreshEnabled"]').checked,
          intervalMs: Number(form.querySelector('[data-setting="snapshotRefreshIntervalMs"]').value || 15000)
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
          type: this.querySelector('[data-filter="type"]').value
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
        let prompt = "";

        if (action?.requiresPrompt) {
          prompt = window.prompt(`${action.label} prompt`) || "";
        }

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

function renderFilters(filters, sources, types) {
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
      <label>
        <span>Type</span>
        <select data-filter="type">
          ${["all", ...types].map((type) => renderOption(type, filters.type, type === "all" ? "All" : labelize(type))).join("")}
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
              <strong>${escapeText(record.label)}</strong>
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

function renderSourceList(agents, providers, message = "") {
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
            <strong>${escapeText(labelize(source))}</strong>
            <p>${sourceAgents.length} agents, ${running} running</p>
          </div>
          <span>${escapeText(sourceAgents.map((agent) => agent.provider).filter(unique).join(", "))} · ${formatScanFreshness(sourceAgents)}</span>
        </article>
      `;
    })
    .join("");

  const providerRows = providers
    .map(
      (provider) => `
        <article class="source-row ${provider.status === "error" ? "source-error" : ""}">
          <div>
            <strong>${escapeText(provider.label)}</strong>
            <p>${provider.status === "error" ? escapeText(provider.error) : `${Number(provider.agentCount || 0)} agents`}</p>
          </div>
          <span>${escapeText(labelize(provider.status))} · ${formatScanFreshness([provider])}</span>
          <button class="icon-button" type="button" title="Test provider connection" data-test-provider="${escapeAttribute(provider.id)}">✓</button>
        </article>
      `
    )
    .join("");

  return `${message ? `<p class="source-message">${escapeText(message)}</p>` : ""}${sourceRows}${providerRows}`;
}

function renderScannerStatus(scanner) {
  if (!scanner) return "";
  const state = scanner.enabled ? (scanner.running ? "Scanning now" : "Background scan on") : "Background scan off";
  const detail = scanner.lastFinishedAt
    ? `Last scan ${formatScanFreshness([{ scannedAt: scanner.lastFinishedAt }])}`
    : `${Math.round(Number(scanner.intervalMs || 15000) / 1000)}s interval`;
  return `
    <p class="source-message">
      ${escapeText(state)} · ${escapeText(detail)}${scanner.lastError ? ` · ${escapeText(scanner.lastError)}` : ""}
    </p>
  `;
}

function renderSettings(config, mode = "local", message = "") {
  const discovery = config?.localDiscovery || { enabled: true, include: [], exclude: [] };
  const snapshotRefresh = config?.snapshotRefresh || { enabled: false, intervalMs: 15000 };
  const providerCounts = config?.providerCounts || {};
  const localAgents = config?.localAgents || [];
  const remoteProviders = config?.remoteHttpProviders || [];
  const openAIProviders = config?.openAIResponsesProviders || [];
  const anthropicProviders = config?.anthropicMessageBatchesProviders || [];
  return `
    <section class="settings-block">
      <div class="settings-heading">
        <h2>Settings</h2>
        ${message ? `<span>${escapeText(message)}</span>` : ""}
      </div>
      ${renderValidationWarnings(config?.validationWarnings || [])}
      <form class="settings-form">
        <label>
          <span>Trusted Origins</span>
          <textarea data-setting="allowedOrigins" rows="3" ${mode === "api" ? "" : "disabled"}>${escapeText((config?.allowedOrigins || []).join("\n"))}</textarea>
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
          <input data-setting="snapshotRefreshIntervalMs" type="number" min="5000" max="300000" step="1000" value="${Number(snapshotRefresh.intervalMs || 15000)}" ${mode === "api" ? "" : "disabled"} />
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
    </section>
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
      <input data-remote-field="token" type="password" value="" ${disabled} aria-label="Remote provider token ${index + 1}" />
      <span>${provider.hasToken ? "Token saved" : "No token"}</span>
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
      <textarea data-openai-field="responses" rows="3" ${disabled} aria-label="OpenAI response list ${index + 1}">${escapeText(formatTrackedLines(provider.responses || [], "responseId"))}</textarea>
      <span>${provider.hasApiKey ? "API key saved" : "No API key"} · responses: id | name | responseId | task | goToUrl</span>
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
      <textarea data-anthropic-field="batches" rows="3" ${disabled} aria-label="Anthropic batch list ${index + 1}">${escapeText(formatTrackedLines(provider.batches || [], "batchId"))}</textarea>
      <span>${provider.hasApiKey ? "API key saved" : "No API key"} · batches: id | name | batchId | task | goToUrl</span>
    </fieldset>
  `;
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
        <button class="agent-link" type="button" data-select-agent="${escapeAttribute(agent.id)}">${escapeText(agent.name)}</button>
        <p>${escapeText(agent.provider)} · ${escapeText(labelize(agent.type || agent.providerId || agent.source))} · ${escapeText(agent.task)}</p>
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

function renderDetailPanel(detail) {
  if (!detail?.agent) return "";

  const { agent, parent, children, history } = detail;
  return `
    <section class="detail-panel">
      <div class="detail-heading">
        <div>
          <p class="eyebrow">Selected Agent</p>
          <h2>${escapeText(agent.name)}</h2>
        </div>
        <span class="status-pill ${escapeAttribute(statusTone(agent.status))}">${escapeText(agent.status)}</span>
      </div>
      <div class="detail-grid">
        <article>
          <span>Provider</span>
          <strong>${escapeText(agent.provider)}</strong>
          <p>${escapeText(labelize(agent.type || agent.providerId || "unknown"))} · ${escapeText(agent.providerId || agent.source || "unknown")}</p>
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
          <p><strong>Parent:</strong> ${escapeText(parent?.name || "Root")}</p>
          <p><strong>Children:</strong> ${children.length ? escapeText(children.map((child) => child.name).join(", ")) : "None"}</p>
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
        <p class="log-line ${escapeAttribute(log.level || "info")}">
          <strong>${escapeText(log.source || "agent")}</strong>
          <span>${formatTimestamp(log.at)} · ${escapeText(log.message)}</span>
        </p>
      `
    )
    .join("");
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

function renderDetailHistory(record) {
  return `
    <p>
      <strong>${escapeText(record.label)}</strong>
      <span>${formatTimestamp(record.at)}${record.prompt ? ` · ${escapeText(record.prompt)}` : ""}</span>
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
      [agent.name, agent.provider, agent.task, agent.id, agent.providerId, agent.source, agent.type]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    const matchesStatus = filters.status === "all" || agent.status === filters.status;
    const matchesSource = filters.source === "all" || agent.source === filters.source;
    const matchesType = filters.type === "all" || (agent.type || agent.providerId || agent.source) === filters.type;
    return matchesQuery && matchesStatus && matchesSource && matchesType;
  });
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
        responses: parseTrackedLines(fields.responses, "responseId")
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
        batches: parseTrackedLines(fields.batches, "batchId")
      };
    })
    .filter((provider) => provider.id && provider.batches.length);
}

function rowFields(row, prefix) {
  return Object.fromEntries(
    [...row.querySelectorAll(`[data-${prefix}-field]`)].map((input) => [
      input.getAttribute(`data-${prefix}-field`),
      input.value.trim()
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
