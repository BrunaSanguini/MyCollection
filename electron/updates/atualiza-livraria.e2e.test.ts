import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AppEntry } from '../../shared/library';
import type { ProcessState, ProcessStatus } from '../../shared/process';
import { MINHA_LIVRARIA } from '../../shared/templates';
import type { UpdateProgress } from '../../shared/updates';
import { ProcessManager } from '../launcher/process-manager';
import { AppUpdater, installedVersion, type Fetch } from './app-updater';

/**
 * A atualização de verdade, no Windows: a Minha Livraria 1.0.0 aberta pelo hub é atualizada
 * para a última release do GitHub e volta a abrir sozinha.
 *
 * Só roda com MINHA_LIVRARIA_OLD_DIR apontando para a pasta extraída do zip da 1.0.0
 * (job "minha-livraria" do CI).
 */
const DIR = process.env['MINHA_LIVRARIA_OLD_DIR'];
const TOKEN = process.env['GITHUB_TOKEN'];

const app: AppEntry = {
  ...MINHA_LIVRARIA.entry,
  id: 'minha-livraria',
  folderId: '',
  workingDir: DIR ?? '',
  openMode: 'none',
};

const manager = new ProcessManager({
  emit: () => undefined,
  open: () => undefined,
  readyTimeoutMs: 180_000,
  contractStopTimeoutMs: 60_000,
});

afterAll(() => manager.shutdown(), 120_000);

/** No CI, a API do GitHub com o token do job (sem ele o limite é por IP, dividido com outros) */
const githubFetch: Fetch = (input, init) =>
  fetch(input, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      ...(TOKEN && input.startsWith('https://api.github.com/')
        ? { Authorization: `Bearer ${TOKEN}` }
        : {}),
    },
  });

async function waitFor(status: ProcessStatus): Promise<ProcessState> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = manager.list().find((s) => s.id === app.id);
    if (state?.status === status) return state;
    if (state?.status === 'error') break;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`não chegou em ${status}:\n${manager.getLogs(app.id).slice(-60).join('\n')}`);
}

describe.skipIf(!DIR)('Atualizar a Minha Livraria pelo hub', () => {
  it('fecha a 1.0.0, instala a última release e abre de novo', async () => {
    expect(await installedVersion(app.workingDir)).toBe('1.0.0');
    await manager.start(app);
    await waitFor('running');

    const phases: UpdateProgress['phase'][] = [];
    const updater = new AppUpdater({
      downloadDir: mkdtempSync(path.join(tmpdir(), 'mc-downloads-')),
      fetch: githubFetch,
      stop: (id) => manager.stop(id),
      start: (entry) => manager.start(entry),
      isActive: (id) =>
        manager.list().some((p) => p.id === id && p.status !== 'stopped' && p.status !== 'error'),
      log: (id, line) => manager.note(id, line),
      progress: (_id, p) => {
        if (phases.at(-1) !== p.phase) phases.push(p.phase);
      },
    });

    const info = await updater.update(app);
    expect(info?.available).toBe(false);
    expect(info?.installed).toBe(info?.latest);
    expect(info?.installed).not.toBe('1.0.0');
    expect(phases).toEqual([
      'stopping',
      'downloading',
      'verifying',
      'installing',
      'starting',
      'done',
    ]);

    const running = await waitFor('running');
    const home = await fetch(running.url!);
    expect(await home.text()).toContain('<ml-root');

    expect((await manager.stop(app.id)).status).toBe('stopped');
    expect(manager.getLogs(app.id).join('\n')).toContain('O app fechou sozinho');
  }, 600_000);
});
