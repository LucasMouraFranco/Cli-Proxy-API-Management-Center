import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { QuotaBurnPanel } from '../src/features/quota/components/QuotaBurnPanel';

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 12, 12).getTime();

let previousLanguage = 'en';
beforeAll(async () => {
  previousLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

describe('QuotaBurnPanel rendering', () => {
  test('headlines the pool, its drain rate and the next reset', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaBurnPanel, {
        type: 'claude',
        nowMs: NOW,
        accounts: [
          {
            remaining: 50,
            resetAtMs: NOW + 30 * HOUR,
            readings: [
              { at: NOW - 10 * HOUR, remaining: 80 },
              { at: NOW, remaining: 50 },
            ],
          },
          { remaining: 100, resetAtMs: null, readings: [] },
        ],
      })
    );
    expect(markup).toContain('150%');
    expect(markup).toContain('/ 200% remaining');
    expect(markup).toContain('~3.0% per hour');
    // The drain is split over both accounts, so the resetting one still has 5% left.
    expect(markup).toContain('Next reset +95%');
  });

  test('renders nothing until an account has a known weekly quota', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaBurnPanel, {
        type: 'codex',
        nowMs: NOW,
        accounts: [{ remaining: null, resetAtMs: null, readings: [] }],
      })
    );
    expect(markup).toBe('');
  });
});
