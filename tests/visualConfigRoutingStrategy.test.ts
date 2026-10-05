import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { parseRoutingStrategy, useVisualConfig } from '../src/hooks/useVisualConfig';
import { runVisualConfig } from './helpers/visualConfig';

describe('visual config weighted routing strategy', () => {
  test('recognizes the weighted-round-robin backend value', () => {
    expect(parseRoutingStrategy('weighted-round-robin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('weightedroundrobin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('wrr')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('fill-first')).toBe('fill-first');
    expect(parseRoutingStrategy('fillfirst')).toBe('fill-first');
    expect(parseRoutingStrategy('ff')).toBe('fill-first');
    expect(parseRoutingStrategy(undefined)).toBe('round-robin');
  });

  test('recognizes the soonest-reset backend value', () => {
    expect(parseRoutingStrategy('soonest-reset')).toBe('soonest-reset');
    expect(parseRoutingStrategy(' Soonest-Reset ')).toBe('soonest-reset');
    expect(parseRoutingStrategy('soonestreset')).toBe('soonest-reset');
    expect(parseRoutingStrategy('sr')).toBe('soonest-reset');
  });

  test('writes weighted-round-robin without coercing it to round-robin', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.setVisualValues({ routingStrategy: 'weighted-round-robin' });
        setPhase(1);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml('routing:\n  strategy: round-robin\n')
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const result = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(parseYaml(result)).toEqual({ routing: { strategy: 'weighted-round-robin' } });
  });

  test('writes soonest-reset without coercing it to round-robin', () => {
    const yaml = 'routing:\n  strategy: round-robin\n';
    const visual = runVisualConfig(yaml, [{ routingStrategy: 'soonest-reset' }]);
    expect(parseYaml(visual.applyVisualChangesToYaml(yaml))).toEqual({
      routing: { strategy: 'soonest-reset' },
    });
  });

  test('keeps a soonest-reset config on reload', () => {
    const visual = runVisualConfig('routing:\n  strategy: soonest-reset\n');
    expect(visual.visualValues.routingStrategy).toBe('soonest-reset');
  });
});
