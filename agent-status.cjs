'use strict';

const PROVIDERS = [
  { id: 'antigravity', name: 'Antigravity', surface: 'App · CLI · IDE' },
  { id: 'copilot', name: 'Copilot CLI', surface: 'CLI' },
  { id: 'claude', name: 'Claude Code', surface: 'CLI · IDE · Desktop Code' }
];

const EVENT_STATUS = {
  antigravity: {
    SessionStart: 'idle',
    PreInvocation: 'running',
    PostInvocation: 'running'
  },
  copilot: {
    sessionStart: 'idle',
    SessionStart: 'idle',
    userPromptSubmitted: 'running',
    UserPromptSubmit: 'running',
    agentStop: 'idle',
    Stop: 'idle',
    sessionEnd: 'ended',
    SessionEnd: 'ended'
  },
  claude: {
    SessionStart: 'idle',
    UserPromptSubmit: 'running',
    Stop: 'idle',
    StopFailure: 'idle',
    SessionEnd: 'ended',
    SubagentStart: 'running',
    SubagentStop: 'ended'
  }
};

const MAX_TRACKED_SESSIONS = 200;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_ENDED_RETENTION_MS = 60 * 1000;

function validId(value) {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= 160 &&
    !/[\x00-\x1f\x7f]/.test(value);
}

function firstString() {
  for (const value of arguments) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function safeLabel(value, pathLike) {
  if (typeof value !== 'string') return '';
  let label = value.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (pathLike) {
    const parts = label.split(/[\\/]+/).filter(Boolean);
    label = parts[parts.length - 1] || '';
  }
  return label.slice(0, 64);
}

function statusFor(provider, eventName, input) {
  if (provider === 'antigravity' && eventName === 'Stop') {
    if (input.fullyIdle === true) return 'idle';
    if (input.fullyIdle === false) return 'running';
    return null;
  }
  const events = EVENT_STATUS[provider];
  return events && Object.prototype.hasOwnProperty.call(events, eventName)
    ? events[eventName]
    : null;
}

function normalizeProviderEvent(provider, eventName, input, receivedAt) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_STATUS, provider) ||
      typeof eventName !== 'string' ||
      !input || typeof input !== 'object' || Array.isArray(input)) return null;

  const status = statusFor(provider, eventName, input);
  const sessionId = firstString(input.sessionId, input.session_id, input.conversationId, input.conversation_id);
  const agentId = firstString(input.agentId, input.agent_id);
  const updatedAt = receivedAt === undefined ? Date.now() : receivedAt;
  if (!status || !validId(sessionId) || (agentId && !validId(agentId)) ||
      !Number.isFinite(updatedAt)) return null;

  const workspacePath = firstString(
    input.cwd,
    input.workspacePath,
    Array.isArray(input.workspacePaths) ? input.workspacePaths[0] : ''
  );
  const workspaceName = safeLabel(workspacePath, true);
  const agentType = safeLabel(firstString(input.agentType, input.agent_type), false);
  const record = {
    provider,
    event: eventName,
    sessionId,
    status,
    workspaceName,
    updatedAt
  };
  if (agentId) record.agentId = agentId;
  if (agentType) record.agentType = agentType;
  return record;
}

function validateNormalizedEvent(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      !Object.prototype.hasOwnProperty.call(EVENT_STATUS, record.provider) ||
      typeof record.event !== 'string' ||
      !validId(record.sessionId) ||
      (record.agentId !== undefined && !validId(record.agentId)) ||
      !Number.isFinite(record.updatedAt) || record.updatedAt < 0 ||
      record.updatedAt > Date.now() + 60000) return null;

  const expected = statusFor(record.provider, record.event, record);
  const antigravityStop = record.provider === 'antigravity' && record.event === 'Stop';
  if (antigravityStop
    ? !['idle', 'running'].includes(record.status)
    : record.status !== expected) return null;
  const clean = {
    provider: record.provider,
    event: record.event,
    sessionId: record.sessionId,
    status: record.status,
    workspaceName: safeLabel(record.workspaceName, false),
    updatedAt: record.updatedAt
  };
  if (record.agentId) clean.agentId = record.agentId;
  const agentType = safeLabel(record.agentType, false);
  if (agentType) clean.agentType = agentType;
  return clean;
}

class AgentStatusStore {
  constructor(options) {
    const config = options || {};
    this.staleAfterMs = Number.isFinite(config.staleAfterMs)
      ? config.staleAfterMs
      : DEFAULT_STALE_AFTER_MS;
    this.endedRetentionMs = Number.isFinite(config.endedRetentionMs)
      ? config.endedRetentionMs
      : DEFAULT_ENDED_RETENTION_MS;
    this.sessions = new Map();
  }

  apply(record) {
    const clean = validateNormalizedEvent(record);
    if (!clean) return false;
    const key = [clean.provider, clean.sessionId, clean.agentId || ''].join('\0');
    if (!this.sessions.has(key) && this.sessions.size >= MAX_TRACKED_SESSIONS) {
      const oldest = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
      if (oldest) this.sessions.delete(oldest[0]);
    }
    this.sessions.set(key, clean);
    return true;
  }

  snapshot(now) {
    const timestamp = Number.isFinite(now) ? now : Date.now();
    const sessions = new Map(PROVIDERS.map(provider => [provider.id, []]));
    for (const [key, record] of this.sessions) {
      const age = Math.max(0, timestamp - record.updatedAt);
      if (record.status === 'ended' && age > this.endedRetentionMs) {
        this.sessions.delete(key);
        continue;
      }
      if (record.status !== 'ended' && age > this.staleAfterMs * 2) {
        this.sessions.delete(key);
        continue;
      }
      sessions.get(record.provider).push({
        workspaceName: record.workspaceName,
        agentType: record.agentType || '',
        event: record.event,
        status: record.status !== 'ended' && age > this.staleAfterMs
          ? 'unknown'
          : record.status,
        updatedAt: record.updatedAt
      });
    }

    return PROVIDERS.map(provider => {
      const rows = sessions.get(provider.id).sort((a, b) => b.updatedAt - a.updatedAt);
      const statuses = rows.map(row => row.status);
      const status = statuses.includes('running') ? 'running'
        : statuses.includes('idle') ? 'idle'
          : statuses.includes('ended') ? 'ended'
            : 'unknown';
      return {
        id: provider.id,
        name: provider.name,
        surface: provider.surface,
        status,
        activeCount: statuses.filter(value => value === 'running').length,
        sessions: rows
      };
    });
  }
}

module.exports = {
  AgentStatusStore,
  normalizeProviderEvent,
  validateNormalizedEvent,
  DEFAULT_STALE_AFTER_MS,
  DEFAULT_ENDED_RETENTION_MS
};
