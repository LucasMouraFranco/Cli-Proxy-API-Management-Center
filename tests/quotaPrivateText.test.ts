import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../src/i18n/index';
import { PrivateText } from '../src/features/quota/components/PrivateText';

const EMAIL = 'tiago@example.com';

const render = (text: string, showEmails: boolean) =>
  renderToStaticMarkup(createElement(PrivateText, { text, className: 'name', showEmails }));

/** Attributes holding the email; a tooltip or screen reader would expose these. */
const emailAttributes = (markup: string) =>
  [...markup.matchAll(/[\w-]+="([^"]*)"/g)].filter(([, value]) => value.includes(EMAIL));

describe('quota account email privacy', () => {
  test('blurs emails behind a click-to-reveal button without leaking them in attributes', () => {
    const markup = render(EMAIL, false);
    expect(markup).toMatch(/^<button type="button"[^>]*aria-label="[^"]+"[^>]*><span[^>]*>/);
    expect(markup).toContain(`>${EMAIL}</span></button>`);
    expect(emailAttributes(markup)).toEqual([]);
  });

  test('shows plain text when "Show emails" is on', () => {
    expect(render(EMAIL, true)).toBe(`<span class="name" title="${EMAIL}">${EMAIL}</span>`);
  });

  test('never blurs nicknames', () => {
    expect(render('Tiago account', false)).toBe(
      '<span class="name" title="Tiago account">Tiago account</span>'
    );
  });
});
