import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';

describe('visual config session affinity default', () => {
  test('shows session affinity as on when the key is absent', () => {
    const visual = runVisualConfig('routing:\n  strategy: round-robin\n');
    expect(visual.visualValues.routingSessionAffinity).toBe(true);
  });

  test('keeps an explicit false', () => {
    const visual = runVisualConfig('routing:\n  session-affinity: false\n');
    expect(visual.visualValues.routingSessionAffinity).toBe(false);
  });

  test('writes an explicit false when the user turns it off', () => {
    const yaml = 'routing:\n  strategy: round-robin\n';
    const visual = runVisualConfig(yaml, [{ routingSessionAffinity: false }]);
    expect(parseYaml(visual.applyVisualChangesToYaml(yaml))).toEqual({
      routing: { strategy: 'round-robin', 'session-affinity': false },
    });
  });
});
