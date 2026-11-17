import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { type AppSession, SessionStore } from './session-store.js';

const SESSION: AppSession = {
  appId: 'minha-livraria',
  port: 8471,
  token: 'abc',
  pid: 42,
  startedAt: '2026-11-17T12:00:00.000Z',
};

describe('SessionStore', () => {
  it('saves, finds and removes a session in a JSON file it creates', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hub-')), 'state', 'sessions.json');
    const store = new SessionStore(file);

    expect(await store.get('minha-livraria')).toBeUndefined();
    await store.save(SESSION);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ 'minha-livraria': SESSION });
    expect(await new SessionStore(file).get('minha-livraria')).toEqual(SESSION);

    await store.remove('minha-livraria');
    expect(await store.get('minha-livraria')).toBeUndefined();
  });
});
