import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types';
import { getQuotaAccountLabel } from '@/utils/quota/identity';

const claude = (extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'claude-6d4d43ff-lucas@example.com.json',
  provider: 'claude',
  ...extra,
});

describe('quota account label', () => {
  test('uses the note as a nickname and keeps the email visible below it', () => {
    expect(getQuotaAccountLabel(claude({ note: '  Work ', email: 'lucas@example.com' }))).toEqual({
      name: 'Work',
      detail: 'lucas@example.com',
    });
  });

  test('falls back to the email, then the file name, when there is no note', () => {
    expect(getQuotaAccountLabel(claude({ email: 'lucas@example.com', note: '   ' }))).toEqual({
      name: 'lucas@example.com',
      detail: null,
    });
    expect(getQuotaAccountLabel(claude())).toEqual({
      name: 'claude-6d4d43ff-lucas@example.com.json',
      detail: null,
    });
  });

  test('keeps the file name visible when a nicknamed account has no email', () => {
    expect(getQuotaAccountLabel({ name: 'kimi-1.json', provider: 'kimi', note: 'Spare' })).toEqual({
      name: 'Spare',
      detail: 'kimi-1.json',
    });
  });

  test('never shows the account field, which can hold an API key', () => {
    const label = getQuotaAccountLabel(claude({ account: 'sk-secret', note: 'Work' }));
    expect(JSON.stringify(label)).not.toContain('sk-secret');
  });

  test('keeps same-file Devin identities apart', () => {
    const devin = { name: 'shared.json', provider: 'devin', note: 'Team' };
    expect(getQuotaAccountLabel({ ...devin, authIndex: '1' }).detail).toBe('shared.json · 1');
    expect(getQuotaAccountLabel({ ...devin, authIndex: '2' }).detail).toBe('shared.json · 2');
  });
});
