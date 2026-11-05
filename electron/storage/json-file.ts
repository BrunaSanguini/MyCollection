import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Arquivo JSON com escrita atômica e fila de gravações.
 * - Grava em .tmp e renomeia: o arquivo nunca fica pela metade
 * - Arquivo corrompido é preservado como .corrupt-<data>.json e o padrão é usado
 * - Gravações são serializadas (nunca duas ao mesmo tempo)
 */
export class JsonFile<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly filePath: string,
    private readonly sanitize: (raw: unknown) => T,
    private readonly fallback: () => T,
  ) {}

  async read(): Promise<T> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return this.write(this.fallback());
      throw err;
    }

    try {
      return this.sanitize(JSON.parse(raw));
    } catch (err) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = this.filePath.replace(/\.json$/, `.corrupt-${stamp}.json`);
      await fs.rename(this.filePath, backup).catch(() => undefined);
      console.error(`[json] ${path.basename(this.filePath)} inválido, backup em ${backup}`, err);
      return this.write(this.fallback());
    }
  }

  write(value: T): Promise<T> {
    const clean = this.sanitize(value);
    const run = async (): Promise<T> => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(clean, null, 2) + '\n', 'utf-8');
      await renameWithRetry(tmp, this.filePath);
      return clean;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/** No Windows o rename pode falhar por alguns ms se o antivírus/indexador estiver lendo o arquivo. */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= attempts - 1 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}
