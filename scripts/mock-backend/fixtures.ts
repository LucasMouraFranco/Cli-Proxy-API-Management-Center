/**
 * Fictitious accounts for the local mock management backend. Every email uses the
 * reserved `.test` TLD and every token is a placeholder; nothing here is a real account.
 * Reset times are relative to server start so countdowns stay realistic.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ClaudeFixture = {
  email: string;
  authIndex: string;
  /** Percent used per Claude bucket; null resets mean "no reset pending". */
  fable: { used: number; resetInMs: number };
  fiveHour: { used: number; resetInMs: number | null };
  sevenDay: { used: number; resetInMs: number };
  opus: { used: number; resetInMs: number };
  tokens: TokenFixture;
};

export type CodexFixture = {
  accountId: string;
  email: string;
  authIndex: string;
  weekly: { used: number; resetInMs: number };
  renewsInMs: number;
  manualResets: number;
  manualResetExpiresInMs: number;
  tokens: TokenFixture;
};

export type TokenFixture = {
  requests: number;
  uncached: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Cache writes per recent 10-minute bucket, oldest first (18 buckets). */
  recentWrites?: number[];
};

const steadyWrites = (base: number) =>
  Array.from({ length: 18 }, (_, index) => (index % 4 === 0 ? base : Math.round(base / 6)));

export const claudeFixtures: ClaudeFixture[] = [
  {
    email: 'tooling@lumen.dev.test',
    authIndex: 'claude-1',
    fable: { used: 42, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    sevenDay: { used: 21, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    opus: { used: 64, resetInMs: 1 * DAY_MS + 3 * HOUR_MS },
    tokens: {
      requests: 412,
      uncached: 9_800,
      output: 1_240_000,
      cacheRead: 48_300_000,
      cacheWrite: 1_920_000,
      recentWrites: steadyWrites(38_000),
    },
  },
  {
    email: 'team@pixel.gg.test',
    authIndex: 'claude-2',
    fable: { used: 0, resetInMs: 4 * DAY_MS + 2 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    sevenDay: { used: 0, resetInMs: 4 * DAY_MS + 2 * HOUR_MS },
    opus: { used: 0, resetInMs: 4 * DAY_MS + 2 * HOUR_MS },
    tokens: { requests: 0, uncached: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    email: 'tests@tide.gg.test',
    authIndex: 'claude-3',
    fable: { used: 0, resetInMs: 4 * DAY_MS + 18 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    sevenDay: { used: 0, resetInMs: 4 * DAY_MS + 18 * HOUR_MS },
    opus: { used: 0, resetInMs: 4 * DAY_MS + 18 * HOUR_MS },
    tokens: { requests: 0, uncached: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    email: 'tasks@tide.gg.test',
    authIndex: 'claude-4',
    fable: { used: 49, resetInMs: 1 * DAY_MS - 2 * HOUR_MS },
    fiveHour: { used: 1, resetInMs: 3 * HOUR_MS + 50 * 60 * 1000 },
    sevenDay: { used: 25, resetInMs: 1 * DAY_MS - 2 * HOUR_MS },
    opus: { used: 12, resetInMs: 1 * DAY_MS - 2 * HOUR_MS },
    tokens: {
      requests: 357,
      uncached: 7_100,
      output: 980_000,
      cacheRead: 39_600_000,
      cacheWrite: 2_700_000,
      // A burst of cache writes 30-40 minutes ago: a conversation moved here.
      recentWrites: [...steadyWrites(30_000).slice(0, 14), 410_000, 360_000, 22_000, 9_000],
    },
  },
  {
    email: 'main@grove.com.test',
    authIndex: 'claude-5',
    fable: { used: 0, resetInMs: 5 * DAY_MS + 7 * HOUR_MS },
    fiveHour: { used: 0, resetInMs: null },
    sevenDay: { used: 0, resetInMs: 5 * DAY_MS + 7 * HOUR_MS },
    opus: { used: 0, resetInMs: 5 * DAY_MS + 7 * HOUR_MS },
    tokens: { requests: 0, uncached: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

export const codexFixtures: CodexFixture[] = [
  {
    accountId: 'ae5d455f',
    email: 'tooling@lumen.dev.test',
    authIndex: 'codex-1',
    weekly: { used: 83, resetInMs: 2 * DAY_MS + 22 * 60 * 1000 },
    renewsInMs: 21 * DAY_MS,
    manualResets: 2,
    manualResetExpiresInMs: 22 * DAY_MS,
    tokens: {
      requests: 186,
      uncached: 1_350_000,
      output: 610_000,
      cacheRead: 21_700_000,
      cacheWrite: 0,
      recentWrites: Array.from({ length: 18 }, () => 0),
    },
  },
  {
    accountId: 'b81c02aa',
    email: 'team@tide.gg.test',
    authIndex: 'codex-2',
    weekly: { used: 100, resetInMs: 3 * DAY_MS - 2 * HOUR_MS },
    renewsInMs: -4 * DAY_MS,
    manualResets: 3,
    manualResetExpiresInMs: 8 * DAY_MS,
    tokens: {
      requests: 240,
      uncached: 2_100_000,
      output: 830_000,
      cacheRead: 30_900_000,
      cacheWrite: 0,
    },
  },
  {
    accountId: 'c4f7e019',
    email: 'main@grove.com.test',
    authIndex: 'codex-3',
    weekly: { used: 100, resetInMs: 2 * DAY_MS },
    renewsInMs: -42 * DAY_MS,
    manualResets: 3,
    manualResetExpiresInMs: 8 * DAY_MS,
    tokens: {
      requests: 199,
      uncached: 1_800_000,
      output: 700_000,
      cacheRead: 26_400_000,
      cacheWrite: 0,
    },
  },
];

export const xaiFixture = {
  email: 'tooling@grove.com.test',
  authIndex: 'xai-1',
  weeklyResetInMs: 5 * DAY_MS + 2 * HOUR_MS,
};

export const kimiFixture = {
  email: 'tooling@grove.com.test',
  authIndex: 'kimi-1',
  weeklyResetInMs: 5 * DAY_MS - 1 * HOUR_MS,
};

export const MOCK_CONFIG_YAML = `# Mock backend config; all values are fictitious.
config-version: 8
server:
  host: localhost
  port: 8317
management:
  allow-remote: false
  panel-github-repository: https://github.com/LucasMouraFranco/Cli-Proxy-API-Management-Center
access:
  api-keys: []
routing:
  strategy: soonest-reset
  session-affinity-ttl: 1h
  retry:
    request-retry: 3
  cooldown:
    disable-cooling: false
oauth:
  auth-dir: ./mock-auths
`;
