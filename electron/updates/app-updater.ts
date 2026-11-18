import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { AppEntry } from '../../shared/library';
import type { ProcessState } from '../../shared/process';
import {
  assetName,
  cleanVersion,
  isNewer,
  releaseSourceOf,
  type ReleaseSource,
  type UpdateInfo,
  type UpdateProgress,
} from '../../shared/updates';
import { extractZip } from './zip';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface AppUpdaterOptions {
  /** Onde o zip é baixado antes de instalar */
  downloadDir: string;
  stop(id: string): Promise<ProcessState>;
  start(app: AppEntry): Promise<ProcessState>;
  isActive(id: string): boolean;
  log(id: string, line: string): void;
  progress(id: string, progress: UpdateProgress): void;
  fetch?: Fetch;
  /** API do GitHub (trocada nos testes) */
  apiBase?: string;
  /** Pausa entre tentativas de renomear a pasta (o Windows às vezes ainda segura um arquivo) */
  retryDelayMs?: number;
}

interface Release {
  version: string;
  url: string;
  zipUrl: string;
  zipSize: number;
  checksumUrl: string;
}

const SHA256_RE = /^[a-f0-9]{64}$/;

/**
 * Atualiza um app pela última release do GitHub: fecha o app, baixa o zip, confere o SHA-256,
 * troca a pasta e abre de novo. Os dados do app (ex.: %USERPROFILE%\.minha-livraria) ficam fora
 * da pasta e não são tocados; a versão anterior fica em "<pasta>.anterior" até a próxima.
 */
export class AppUpdater {
  private readonly busy = new Set<string>();
  private readonly fetch: Fetch;
  private readonly apiBase: string;
  private readonly retryDelayMs: number;

  constructor(private readonly opts: AppUpdaterOptions) {
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.apiBase = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  isUpdating(id: string): boolean {
    return this.busy.has(id);
  }

  async check(app: AppEntry): Promise<UpdateInfo | null> {
    const source = releaseSourceOf(app);
    if (!source) return null;
    const installed = await installedVersion(app.workingDir);
    try {
      const release = await this.latest(source);
      return {
        appId: app.id,
        installed,
        latest: release.version,
        releaseUrl: release.url,
        available: installed !== undefined && isNewer(release.version, installed),
      };
    } catch (err) {
      return { appId: app.id, installed, available: false, error: messageOf(err) };
    }
  }

  async update(app: AppEntry): Promise<UpdateInfo | null> {
    const source = releaseSourceOf(app);
    if (!source) throw new Error('Este app não tem atualização pelo My Collection.');
    if (this.busy.has(app.id)) throw new Error('A atualização já está em andamento.');
    this.busy.add(app.id);
    let version = '';
    let wasActive = false;
    let installed = false;
    try {
      const release = await this.latest(source);
      version = release.version;
      const current = await installedVersion(app.workingDir);
      if (current !== undefined && !isNewer(version, current)) {
        this.opts.log(app.id, `✔ Já está na versão ${current}.`);
        return this.check(app);
      }
      this.opts.log(app.id, `⬆ Atualizando ${app.name} de ${current ?? '?'} para ${version}`);

      wasActive = this.opts.isActive(app.id);
      if (wasActive) {
        this.opts.progress(app.id, { phase: 'stopping', version });
        const stopped = await this.opts.stop(app.id);
        if (stopped.status !== 'stopped')
          throw new Error('Não consegui fechar o app para atualizar.');
      }

      const zip = await this.download(app, release);
      this.opts.progress(app.id, { phase: 'installing', version });
      await this.install(app, zip);
      installed = true;
      this.opts.log(
        app.id,
        `✔ Versão ${version} instalada. A anterior ficou em ${backupOf(app.workingDir)}`,
      );

      if (wasActive) {
        this.opts.progress(app.id, { phase: 'starting', version });
        await this.opts.start(app);
      }
      this.opts.progress(app.id, { phase: 'done', version });
      return this.check(app);
    } catch (err) {
      const error = messageOf(err);
      this.opts.log(app.id, `✖ A atualização falhou: ${error}`);
      this.opts.progress(app.id, { phase: 'error', version, error });
      // A versão que já estava instalada continua lá: se o app estava aberto, volta a abrir
      if (wasActive && !installed && !this.opts.isActive(app.id)) {
        this.opts.log(app.id, '↺ Abrindo de novo a versão que já estava instalada.');
        await this.opts.start(app).catch(() => undefined);
      }
      throw new Error(error);
    } finally {
      this.busy.delete(app.id);
    }
  }

  private async latest(source: ReleaseSource): Promise<Release> {
    const response = await this.fetch(`${this.apiBase}/repos/${source.repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'My-Collection' },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 403 || response.status === 429) {
      throw new Error('O GitHub limitou as consultas por agora. Tente de novo mais tarde.');
    }
    if (!response.ok)
      throw new Error(`O GitHub respondeu ${response.status} ao procurar a última versão.`);
    const body = (await response.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      assets?: { name?: unknown; size?: unknown; browser_download_url?: unknown }[];
    };
    if (typeof body.tag_name !== 'string') throw new Error('A release não tem versão.');
    const version = cleanVersion(body.tag_name);
    const name = assetName(source, version);
    const assets = Array.isArray(body.assets) ? body.assets : [];
    const zip = assets.find((a) => a.name === name);
    const checksum = assets.find((a) => a.name === `${name}.sha256`);
    if (!zip || typeof zip.browser_download_url !== 'string') {
      throw new Error(`A release ${version} não tem o arquivo ${name}.`);
    }
    if (!checksum || typeof checksum.browser_download_url !== 'string') {
      throw new Error(`A release ${version} não tem o ${name}.sha256 para conferir o download.`);
    }
    return {
      version,
      url:
        typeof body.html_url === 'string'
          ? body.html_url
          : `https://github.com/${source.repo}/releases`,
      zipUrl: zip.browser_download_url,
      zipSize: typeof zip.size === 'number' ? zip.size : 0,
      checksumUrl: checksum.browser_download_url,
    };
  }

  /** Baixa o zip calculando o SHA-256 no caminho e só devolve o arquivo se bater com o da release. */
  private async download(app: AppEntry, release: Release): Promise<string> {
    const version = release.version;
    const checksumResponse = await this.fetch(release.checksumUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!checksumResponse.ok)
      throw new Error(`Não consegui baixar o .sha256 (${checksumResponse.status}).`);
    const expected = (await checksumResponse.text()).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!SHA256_RE.test(expected)) throw new Error('O .sha256 da release não tem um hash válido.');

    await fs.mkdir(this.opts.downloadDir, { recursive: true });
    const file = path.join(this.opts.downloadDir, `${app.id}-${version}.zip`);
    this.opts.progress(app.id, { phase: 'downloading', version, percent: 0 });
    this.opts.log(app.id, `… baixando ${release.zipUrl}`);
    const response = await this.fetch(release.zipUrl);
    if (!response.ok || !response.body) throw new Error(`O download respondeu ${response.status}.`);
    const total = Number(response.headers.get('content-length')) || release.zipSize;

    const hash = createHash('sha256');
    let received = 0;
    let lastPercent = 0;
    const progress = this.opts.progress;
    async function* counted(source: AsyncIterable<Uint8Array>) {
      for await (const chunk of source) {
        hash.update(chunk);
        received += chunk.length;
        const percent = total ? Math.min(99, Math.floor((received / total) * 100)) : 0;
        if (percent > lastPercent) {
          lastPercent = percent;
          progress(app.id, { phase: 'downloading', version, percent });
        }
        yield chunk;
      }
    }
    try {
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
        counted,
        createWriteStream(file),
      );
      this.opts.progress(app.id, { phase: 'verifying', version });
      const actual = hash.digest('hex');
      if (actual !== expected) {
        throw new Error(
          'O arquivo baixado não confere com o SHA-256 da release (download corrompido).',
        );
      }
      this.opts.log(app.id, `✔ SHA-256 conferido (${actual.slice(0, 12)}…)`);
      return file;
    } catch (err) {
      await fs.rm(file, { force: true });
      throw err;
    }
  }

  /** Extrai ao lado da pasta do app e troca as duas pastas, voltando a antiga se algo falhar. */
  private async install(app: AppEntry, zip: string): Promise<void> {
    const target = path.resolve(app.workingDir);
    const staging = path.join(path.dirname(target), `.${path.basename(target)}-atualizacao`);
    const backup = backupOf(target);
    try {
      await fs.rm(staging, { recursive: true, force: true });
      await extractZip(zip, staging);
      const root = await singleFolderIn(staging);
      const executable = executableOf(app.command);
      if (executable && !(await exists(path.join(root, executable)))) {
        throw new Error(`O zip da release não tem o ${executable}.`);
      }

      await fs.rm(backup, { recursive: true, force: true });
      await this.rename(target, backup);
      try {
        await this.rename(root, target);
      } catch (err) {
        await this.rename(backup, target);
        throw err;
      }
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(zip, { force: true }).catch(() => undefined);
    }
  }

  private async rename(from: string, to: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(from, to);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 20 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES')) {
          throw new Error(
            code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
              ? `A pasta ${from} está em uso (Explorer ou antivírus?). Feche e tente de novo.`
              : `Não consegui mover ${from}: ${messageOf(err)}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      }
    }
  }
}

/**
 * A versão gravada pelo jpackage em app\<Nome>.cfg (`-Djpackage.app-version=1.1.0`).
 * undefined quando a pasta não é de um app empacotado assim.
 */
export async function installedVersion(workingDir: string): Promise<string | undefined> {
  const appDir = path.join(workingDir, 'app');
  let files: string[];
  try {
    files = await fs.readdir(appDir);
  } catch {
    return undefined;
  }
  for (const file of files.filter((f) => f.toLowerCase().endsWith('.cfg'))) {
    const content = await fs.readFile(path.join(appDir, file), 'utf-8').catch(() => '');
    const match = /-Djpackage\.app-version=(\d+\.\d+\.\d+)/.exec(content);
    if (match) return match[1];
  }
  return undefined;
}

function backupOf(workingDir: string): string {
  return `${path.resolve(workingDir)}.anterior`;
}

/** O zip da Minha Livraria traz tudo dentro de "MinhaLivraria/"; outros podem vir sem pasta. */
async function singleFolderIn(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.length === 1 && entries[0].isDirectory() ? path.join(dir, entries[0].name) : dir;
}

/** "MinhaLivraria.exe --x" → "MinhaLivraria.exe"; comandos com caminho ou aspas não são conferidos */
function executableOf(command: string): string | undefined {
  const first = command.trim().split(/\s+/)[0] ?? '';
  return /^[\w.-]+\.exe$/i.test(first) ? first : undefined;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

function messageOf(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return 'O GitHub demorou demais para responder.';
    if (err.message === 'fetch failed') return 'Sem conexão com o GitHub.';
    return err.message;
  }
  return String(err);
}
