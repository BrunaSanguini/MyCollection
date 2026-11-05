import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ICON_FILE_RE } from '../../shared/library';

export const ICON_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'];
const MAX_ICON_BYTES = 2 * 1024 * 1024;

/**
 * Imagens dos apps, copiadas para userData/icons.
 * O library.json guarda só o nome do arquivo; o renderer carrega via mc-icon://icons/<arquivo>.
 */
export class IconStore {
  constructor(readonly dir: string) {}

  /** Copia a imagem escolhida e devolve o nome gerado (hash do conteúdo = sem duplicatas) */
  async import(sourcePath: string): Promise<string> {
    const ext = path.extname(sourcePath).slice(1).toLowerCase();
    if (!ICON_EXTENSIONS.includes(ext)) throw new Error(`Formato não suportado: .${ext}`);

    const stat = await fs.stat(sourcePath);
    if (stat.size > MAX_ICON_BYTES) throw new Error('A imagem deve ter no máximo 2 MB.');

    const data = await fs.readFile(sourcePath);
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
    const fileName = `icon-${hash}.${ext}`;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, fileName), data);
    return fileName;
  }

  /** Caminho absoluto de um ícone, ou null se o nome for inválido (evita ../ etc.) */
  resolve(fileName: string): string | null {
    return ICON_FILE_RE.test(fileName) ? path.join(this.dir, fileName) : null;
  }

  /** Apaga imagens que nenhum app usa mais */
  async collectGarbage(inUse: Iterable<string>): Promise<number> {
    const keep = new Set(inUse);
    let files: string[];
    try {
      files = await fs.readdir(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const f of files) {
      if (ICON_FILE_RE.test(f) && !keep.has(f)) {
        await fs.unlink(path.join(this.dir, f)).catch(() => undefined);
        removed++;
      }
    }
    return removed;
  }
}
