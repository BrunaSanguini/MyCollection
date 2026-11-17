import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AppSession, SessionStore } from './session-store';

const session = (appId: string, port = 8471): AppSession => ({
  appId,
  port,
  token: 'ab'.repeat(32),
  pid: 4321,
  startedAt: '2026-11-17T10:00:00.000Z',
});

function newFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'mc-sessions-')), 'sessions.json');
}

describe('SessionStore', () => {
  it('guarda, lê e remove sessões, e elas sobrevivem a um hub novo', async () => {
    const file = newFile();
    await new SessionStore(file).save(session('livraria'));
    await new SessionStore(file).save(session('outro', 9000));

    const reopened = new SessionStore(file);
    expect(await reopened.get('livraria')).toEqual(session('livraria'));
    await reopened.remove('livraria');
    expect(await reopened.get('livraria')).toBeUndefined();
    expect(await reopened.get('outro')).toEqual(session('outro', 9000));
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ outro: session('outro', 9000) });
  });

  it('ignora entradas inválidas de um arquivo editado à mão', async () => {
    const file = newFile();
    writeFileSync(
      file,
      JSON.stringify({
        ok: session('ok'),
        semToken: { ...session('semToken'), token: '' },
        portaRuim: { ...session('portaRuim'), port: 70_000 },
        idTrocado: session('outro-id'),
      }),
    );
    const store = new SessionStore(file);
    expect(await store.get('ok')).toEqual(session('ok'));
    expect(await store.get('semToken')).toBeUndefined();
    expect(await store.get('portaRuim')).toBeUndefined();
    expect(await store.get('idTrocado')).toBeUndefined();
  });

  it('recomeça vazio se o arquivo estiver corrompido', async () => {
    const file = newFile();
    writeFileSync(file, '{ meio json');
    expect(await new SessionStore(file).get('livraria')).toBeUndefined();
  });
});
