import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';

/**
 * Extrai um zip para `destination`. Recusa entradas que sairiam da pasta ("../", caminho absoluto)
 * e links simbólicos.
 */
export async function extractZip(zipFile: string, destination: string): Promise<void> {
  const root = path.resolve(destination);
  await fs.mkdir(root, { recursive: true });
  const zip = await yauzl.openPromise(zipFile, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
  });
  try {
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName.replace(/\\/g, '/');
      const target = path.resolve(root, name);
      if (path.isAbsolute(name) || (target !== root && !target.startsWith(root + path.sep))) {
        throw new Error(`O zip tem um caminho inválido: ${entry.fileName}`);
      }
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode === 0o120000) throw new Error(`O zip tem um link simbólico: ${entry.fileName}`);

      if (name.endsWith('/')) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(target));
    }
  } finally {
    zip.close();
  }
}
