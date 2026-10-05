import { describe, expect, test } from 'bun:test';
import {
  buildAuthFileFieldsPatch,
  type PrefixProxyEditorState,
} from '../src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { readAuthFileWebsockets } from '../src/features/authFiles/constants';

const makeEditor = (
  json: Record<string, unknown>,
  providerKey: string,
  websockets: boolean
): PrefixProxyEditorState => ({
  fileName: 'credential.json',
  fileInfoText: '',
  loading: false,
  saving: false,
  error: null,
  originalText: JSON.stringify(json),
  rawText: JSON.stringify(json),
  invalidContentPreview: '',
  json,
  providerKey,
  prefix: '',
  proxyUrl: '',
  priority: '',
  weight: '',
  weightError: null,
  disableCooling: false,
  disableCoolingTouched: false,
  websockets,
  websocketsTouched: true,
  usingApi: false,
  usingApiTouched: false,
  note: '',
  noteTouched: false,
  excludedModelsText: '',
  excludedModelsTouched: false,
  headersText: '',
  headersTouched: false,
  headersError: null,
});

const resolveError = (key: string) => key;

describe('auth file websockets default', () => {
  test('Codex auth files default to the websocket transport', () => {
    expect(readAuthFileWebsockets({ type: 'codex' })).toBe(true);
    expect(readAuthFileWebsockets({ type: 'codex', websockets: false })).toBe(false);
    expect(readAuthFileWebsockets({ type: 'codex', websocket: 'false' })).toBe(false);
    expect(readAuthFileWebsockets({}, 'codex')).toBe(true);
  });

  test('other providers keep websockets opt-in', () => {
    expect(readAuthFileWebsockets({ type: 'xai' })).toBe(false);
    expect(readAuthFileWebsockets({ type: 'xai', websockets: true })).toBe(true);
    expect(readAuthFileWebsockets({})).toBe(false);
  });

  test('turning the Codex default off writes an explicit false', () => {
    const json = { type: 'codex', email: 'user@example.test' };
    const patch = buildAuthFileFieldsPatch(makeEditor(json, 'codex', false), resolveError);
    expect(patch).toEqual({ websockets: false });
  });

  test('leaving the Codex default on writes nothing', () => {
    const json = { type: 'codex', email: 'user@example.test' };
    const patch = buildAuthFileFieldsPatch(makeEditor(json, 'codex', true), resolveError);
    expect(patch).toEqual({});
  });
});
