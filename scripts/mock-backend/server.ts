/**
 * Local mock of the CLIProxyAPI v8 Management API for UI work and screenshots.
 *
 *   bun scripts/mock-backend/server.ts            # http://localhost:8317
 *   MOCK_PORT=9000 bun scripts/mock-backend/server.ts
 *
 * Log in from `bun run dev` with a custom connection to http://localhost:8317 and any
 * management key. Upstream quota calls made through /requests/api-call are answered from
 * fixtures, so no real credentials are involved.
 */

import { parse as parseYaml } from 'yaml';
import {
  MOCK_CONFIG_YAML,
  claudeFixtures,
  codexFixtures,
  kimiFixture,
  xaiFixture,
  type TokenFixture,
} from './fixtures';

const PORT = Number(process.env.MOCK_PORT ?? 8317);
const PREFIX = '/v8/management';
const startedAt = Date.now();
const BUCKET_MS = 10 * 60 * 1000;
let configYaml = MOCK_CONFIG_YAML;
const consumedCodexResets = new Map<string, number>();

const iso = (offsetMs: number) => new Date(startedAt + offsetMs).toISOString();
const unix = (offsetMs: number) => Math.floor((startedAt + offsetMs) / 1000);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'x-cpa-version, x-cpa-build-date, x-cpa-support-plugin',
  'x-cpa-version': 'v8.0.0-mock',
  'x-cpa-support-plugin': 'false',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const tokenUsage = (tokens: TokenFixture) => {
  if (tokens.requests === 0) return undefined;
  const now = Date.now();
  const current = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const writes = tokens.recentWrites ?? Array.from({ length: 18 }, () => 0);
  return {
    requests: tokens.requests,
    uncached_input_tokens: tokens.uncached,
    output_tokens: tokens.output,
    cache_read_tokens: tokens.cacheRead,
    cache_write_tokens: tokens.cacheWrite,
    since: new Date(startedAt - 6 * 60 * 60 * 1000).toISOString(),
    last_seen: new Date(now - 2 * 60 * 1000).toISOString(),
    recent: writes.map((write, index) => ({
      time: new Date(current - (writes.length - 1 - index) * BUCKET_MS).toISOString(),
      requests: write > 0 ? 3 : 0,
      uncached_input_tokens: write > 0 ? 40 : 0,
      output_tokens: write > 0 ? 2_400 : 0,
      cache_read_tokens: write > 0 ? write * 9 : 0,
      cache_write_tokens: write,
    })),
  };
};

const baseEntry = (
  id: string,
  provider: string,
  name: string,
  authIndex: string,
  email: string
) => ({
  id,
  auth_index: authIndex,
  name,
  type: provider,
  provider,
  label: email,
  email,
  status: 'active',
  status_message: '',
  disabled: false,
  unavailable: false,
  runtime_only: false,
  source: 'file',
  size: 2048,
  modtime: new Date(startedAt - 3 * 24 * 60 * 60 * 1000).toISOString(),
  success: 0,
  failed: 0,
  recent_requests: [],
});

const credentials = () => [
  ...claudeFixtures.map((fixture) => ({
    ...baseEntry(
      `claude-${fixture.email}.json`,
      'claude',
      `claude-${fixture.email}.json`,
      fixture.authIndex,
      fixture.email
    ),
    account_type: 'oauth',
    success: fixture.tokens.requests,
    token_usage: tokenUsage(fixture.tokens),
  })),
  ...codexFixtures.map((fixture) => ({
    ...baseEntry(
      `codex-${fixture.accountId}-${fixture.email}-pro.json`,
      'codex',
      `codex-${fixture.accountId}-${fixture.email}-pro.json`,
      fixture.authIndex,
      fixture.email
    ),
    account_type: 'oauth',
    chatgpt_account_id: fixture.accountId,
    chatgpt_subscription_active_until: iso(fixture.renewsInMs),
    websockets: true,
    success: fixture.tokens.requests,
    token_usage: tokenUsage(fixture.tokens),
  })),
  baseEntry(
    `xai-${xaiFixture.email}.json`,
    'xai',
    `xai-${xaiFixture.email}.json`,
    xaiFixture.authIndex,
    xaiFixture.email
  ),
  baseEntry(
    `kimi-${kimiFixture.email}.json`,
    'kimi',
    `kimi-${kimiFixture.email}.json`,
    kimiFixture.authIndex,
    kimiFixture.email
  ),
];

const findClaude = (authIndex: string) => claudeFixtures.find((f) => f.authIndex === authIndex);
const findCodex = (authIndex: string) => codexFixtures.find((f) => f.authIndex === authIndex);

const upstream = (status: number, body: unknown) => ({
  status_code: status,
  header: {},
  body: JSON.stringify(body),
});

const answerApiCall = (request: {
  authIndex?: string;
  auth_index?: string;
  url?: string;
  method?: string;
}) => {
  const authIndex = String(request.authIndex ?? request.auth_index ?? '');
  const url = String(request.url ?? '');
  const claude = findClaude(authIndex);
  const codex = findCodex(authIndex);

  if (claude && url.startsWith('https://api.anthropic.com/api/oauth/usage')) {
    return upstream(200, {
      five_hour: {
        utilization: claude.fiveHour.used,
        resets_at: claude.fiveHour.resetInMs === null ? null : iso(claude.fiveHour.resetInMs),
      },
      seven_day: { utilization: claude.sevenDay.used, resets_at: iso(claude.sevenDay.resetInMs) },
      seven_day_opus: { utilization: claude.opus.used, resets_at: iso(claude.opus.resetInMs) },
      limits: [
        {
          kind: 'weekly_scoped',
          group: 'weekly',
          percent: claude.fable.used,
          resets_at: iso(claude.fable.resetInMs),
          is_active: true,
          scope: { model: { id: null, display_name: 'Fable 5' } },
        },
      ],
    });
  }
  if (claude && url === 'https://api.anthropic.com/api/oauth/profile') {
    return upstream(200, {
      account: { has_claude_max: true, has_claude_pro: false },
      organization: {
        organization_type: 'claude_max',
        subscription_status: 'active',
        uuid: `org-${authIndex}`,
      },
    });
  }
  if (codex && url === 'https://chatgpt.com/backend-api/wham/usage') {
    const consumed = consumedCodexResets.get(authIndex) ?? 0;
    const used = consumed > 0 ? 0 : codex.weekly.used;
    return upstream(200, {
      plan_type: 'pro',
      rate_limit: {
        allowed: used < 100,
        limit_reached: used >= 100,
        primary_window: {
          used_percent: used,
          limit_window_seconds: 604800,
          reset_after_seconds: Math.max(0, Math.floor(codex.weekly.resetInMs / 1000)),
          reset_at: unix(consumed > 0 ? 7 * 24 * 60 * 60 * 1000 : codex.weekly.resetInMs),
        },
        secondary_window: null,
      },
      code_review_rate_limit: null,
      additional_rate_limits: [],
      rate_limit_reset_credits: {
        available_count: Math.max(0, codex.manualResets - consumed),
        applicable_available_count: Math.max(0, codex.manualResets - consumed),
      },
      credits: { has_credits: false, unlimited: false, balance: '0' },
    });
  }
  if (codex && url.startsWith('https://chatgpt.com/backend-api/subscriptions')) {
    return upstream(200, { active_until: iso(codex.renewsInMs) });
  }
  if (codex && url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits') {
    const remaining = Math.max(0, codex.manualResets - (consumedCodexResets.get(authIndex) ?? 0));
    return upstream(200, {
      available_count: remaining,
      credits: Array.from({ length: remaining }, (_, index) => ({
        id: `credit-${authIndex}-${index}`,
        reset_type: 'codex_rate_limits',
        status: 'available',
        granted_at: iso(-2 * 24 * 60 * 60 * 1000),
        expires_at: iso(codex.manualResetExpiresInMs + index * 24 * 60 * 60 * 1000),
      })),
    });
  }
  if (codex && url === 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume') {
    consumedCodexResets.set(authIndex, (consumedCodexResets.get(authIndex) ?? 0) + 1);
    return upstream(200, { status: 'consumed' });
  }
  if (authIndex === xaiFixture.authIndex) {
    if (url.startsWith('https://cli-chat-proxy.grok.com/v1/billing?format=credits')) {
      return upstream(200, {
        config: {
          currentPeriod: {
            type: 'USAGE_PERIOD_TYPE_WEEKLY',
            start: iso(xaiFixture.weeklyResetInMs - 7 * 24 * 60 * 60 * 1000),
            end: iso(xaiFixture.weeklyResetInMs),
          },
          billingPeriodStart: iso(xaiFixture.weeklyResetInMs - 7 * 24 * 60 * 60 * 1000),
          billingPeriodEnd: iso(xaiFixture.weeklyResetInMs),
          onDemandCap: { val: 0 },
        },
      });
    }
    if (url.startsWith('https://cli-chat-proxy.grok.com/v1/billing')) {
      return upstream(200, {
        config: {
          monthlyLimit: { val: 0 },
          used: { val: 0 },
          onDemandCap: { val: 0 },
          billingPeriodStart: iso(-10 * 24 * 60 * 60 * 1000),
          billingPeriodEnd: iso(20 * 24 * 60 * 60 * 1000),
        },
      });
    }
    return upstream(200, {});
  }
  if (authIndex === kimiFixture.authIndex && url.includes('/coding/v1/usages')) {
    return upstream(200, {
      usage: {
        used: '0',
        limit: '100',
        remaining: '100',
        resetTime: iso(kimiFixture.weeklyResetInMs),
      },
      limits: [],
    });
  }
  return upstream(404, { error: { message: `mock backend has no fixture for ${url}` } });
};

const routingPreview = () => {
  const claudeRanked = [...claudeFixtures].sort((a, b) => a.fable.resetInMs - b.fable.resetInMs);
  const codexRanked = [...codexFixtures].sort((a, b) => a.weekly.resetInMs - b.weekly.resetInMs);
  const claudeCandidates = claudeRanked.map((f) => ({
    auth_id: `claude-${f.email}.json`,
    auth_index: f.authIndex,
    usable: true,
    weekly: { name: '7d_fable', used_percent: f.fable.used, reset_at: iso(f.fable.resetInMs) },
    five_hour: {
      name: '5h',
      used_percent: f.fiveHour.used,
      ...(f.fiveHour.resetInMs ? { reset_at: iso(f.fiveHour.resetInMs) } : {}),
    },
  }));
  const codexCandidates = codexRanked.map((f) => {
    const exhausted = f.weekly.used >= 100 && !consumedCodexResets.get(f.authIndex);
    return {
      auth_id: `codex-${f.accountId}-${f.email}-pro.json`,
      auth_index: f.authIndex,
      usable: !exhausted,
      ...(exhausted ? { skip_reason: 'weekly_limit' } : {}),
      weekly: { name: 'weekly', used_percent: f.weekly.used, reset_at: iso(f.weekly.resetInMs) },
    };
  });
  codexCandidates.sort((a, b) => Number(b.usable) - Number(a.usable));
  return {
    previews: [
      {
        strategy: 'soonest-reset',
        provider: 'claude',
        session_affinity: true,
        auth_id: claudeCandidates[0]?.auth_id,
        candidates: claudeCandidates,
      },
      {
        strategy: 'soonest-reset',
        provider: 'codex',
        session_affinity: true,
        auth_id: codexCandidates[0]?.auth_id,
        candidates: codexCandidates,
      },
    ],
  };
};

const configJson = () => parseYaml(configYaml) ?? {};

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    if (!url.pathname.startsWith(PREFIX)) return json({ error: 'not found' }, 404);
    const path = url.pathname.slice(PREFIX.length) || '/';

    if (path === '/config' && req.method === 'GET') return json(configJson());
    if (path === '/config.yaml' && req.method === 'GET') {
      return new Response(configYaml, {
        headers: { ...corsHeaders, 'Content-Type': 'application/yaml' },
      });
    }
    if (path === '/config.yaml' && req.method === 'PUT') {
      configYaml = await req.text();
      return json({ status: 'ok' });
    }
    if (path === '/config' && (req.method === 'PATCH' || req.method === 'PUT')) {
      return json({ status: 'ok' });
    }
    if (path === '/credentials' && req.method === 'GET') {
      const files = credentials();
      return json({ observed_at: new Date().toISOString(), files, total: files.length });
    }
    if (path === '/requests/api-call' && req.method === 'POST') {
      return json(answerApiCall(await req.json()));
    }
    if (path === '/routing/next' && req.method === 'GET') return json(routingPreview());
    if (path === '/routing/cooldown/reset' && req.method === 'POST') return json({ status: 'ok' });
    if (path === '/observability/usage/api-keys') return json({});
    if (path === '/observability/logs') return json({ lines: [], 'line-count': 0 });
    if (path === '/server/latest-version') return json({ 'latest-version': 'v8.0.0-mock' });
    if (req.method === 'GET') return json({});
    return json({ status: 'ok' });
  },
});

console.log(`mock management backend on http://localhost:${PORT}${PREFIX}`);
