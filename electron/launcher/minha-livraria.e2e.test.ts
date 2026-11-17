import { afterAll, describe, expect, it } from 'vitest';
import type { AppEntry } from '../../shared/library';
import type { ProcessState, ProcessStatus } from '../../shared/process';
import { MINHA_LIVRARIA } from '../../shared/templates';
import { ProcessManager } from './process-manager';

/**
 * O hub com a Minha Livraria de verdade (o zip da release, no Windows), cadastrada pelo modelo:
 * inicia, fica pronta, recebe um livro, fecha pelo shutdown e, na próxima sessão, o livro está lá.
 *
 * Só roda com MINHA_LIVRARIA_DIR apontando para a pasta do MinhaLivraria.exe (job "minha-livraria"
 * do CI, ou à mão: `$env:MINHA_LIVRARIA_DIR='C:\Apps\MinhaLivraria'; npx vitest run minha-livraria`).
 */
const DIR = process.env['MINHA_LIVRARIA_DIR'];
const WRITE = { 'X-Requested-By': 'minha-livraria', 'Content-Type': 'application/json' };

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

afterAll(() => manager.shutdown());

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

describe.skipIf(!DIR)('Minha Livraria pelo hub', () => {
  it('abre, guarda um livro, fecha direito e reabre com o livro', async () => {
    await manager.start(app);
    const first = await waitFor('running');
    const base = first.url!.replace(/\/$/, '');

    const home = await fetch(`${base}/`);
    expect(await home.text()).toContain('<ml-root');

    const author = await fetch(`${base}/api/v1/authors`, {
      method: 'POST',
      headers: WRITE,
      body: JSON.stringify({ name: 'Autora do My Collection' }),
    });
    expect(author.status).toBe(201);
    const { id: authorId } = (await author.json()) as { id: number };
    const book = await fetch(`${base}/api/v1/books`, {
      method: 'POST',
      headers: WRITE,
      body: JSON.stringify({ title: 'Livro salvo pelo hub', authorIds: [authorId] }),
    });
    expect(book.status).toBe(201);
    const { id: bookId } = (await book.json()) as { id: number };

    expect((await manager.stop(app.id)).status).toBe('stopped');
    const logs = manager.getLogs(app.id).join('\n');
    expect(logs).toContain('encerramento aceito');
    expect(logs).toContain('O app fechou sozinho');
    expect(logs).not.toContain('à força');

    manager.clearLogs(app.id);
    await manager.start(app);
    const second = await waitFor('running');
    const again = await fetch(`${second.url!.replace(/\/$/, '')}/api/v1/books/${bookId}`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { title: string }).title).toBe('Livro salvo pelo hub');

    expect((await manager.stop(app.id)).status).toBe('stopped');
    expect(manager.getLogs(app.id).join('\n')).toContain('O app fechou sozinho');
  }, 420_000);
});
