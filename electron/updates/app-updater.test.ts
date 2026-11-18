import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdtempSync, promises as fs, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import type { AppEntry } from '../../shared/library';
import type { ProcessState } from '../../shared/process';
import { MINHA_LIVRARIA } from '../../shared/templates';
import type { UpdateProgress } from '../../shared/updates';
import { AppUpdater, installedVersion } from './app-updater';
import { extractZip } from './zip';

/**
 * O AppUpdater contra um "GitHub" local: a API de releases, o zip e o .sha256 servidos por HTTP,
 * e uma pasta de app como a que o zip da Minha Livraria cria.
 */
const cfg = (version: string) =>
  `[Application]\napp.mainjar=$APPDIR\\minha-livraria.jar\n\n[JavaOptions]\njava-options=-Djpackage.app-version=${version}\njava-options=-Dfile.encoding=UTF-8\n`;

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function zipOf(file: string, entries: Record<string, string>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.from(content), name);
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(file)).on('close', resolve).on('error', reject);
  });
  return readFileSync(file);
}

interface Fixture {
  root: string;
  app: AppEntry;
  updater: AppUpdater;
  calls: string[];
  phases: UpdateProgress['phase'][];
  logs: string[];
}

async function fixture(
  options: {
    zip?: Record<string, string>;
    checksum?: string;
    status?: number;
    running?: boolean;
  } = {},
): Promise<Fixture> {
  const root = mkdtempSync(path.join(tmpdir(), 'mc-update-'));
  const workingDir = path.join(root, 'MinhaLivraria');
  await fs.mkdir(path.join(workingDir, 'app'), { recursive: true });
  await fs.writeFile(path.join(workingDir, 'MinhaLivraria.exe'), 'antigo');
  await fs.writeFile(path.join(workingDir, 'app', 'MinhaLivraria.cfg'), cfg('1.0.0'));

  const zip = await zipOf(
    path.join(root, 'release.zip'),
    options.zip ?? {
      'MinhaLivraria/MinhaLivraria.exe': 'novo',
      'MinhaLivraria/app/MinhaLivraria.cfg': cfg('1.1.0'),
      'MinhaLivraria/runtime/release': 'JAVA_VERSION="25"',
    },
  );
  const name = 'minha-livraria-1.1.0-windows-x64.zip';
  const sha = options.checksum ?? createHash('sha256').update(zip).digest('hex');

  const server = createServer((req, res) => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === '/repos/BrunaSanguini/MyLibrary/releases/latest') {
      if (options.status) {
        res.writeHead(options.status).end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          tag_name: 'v1.1.0',
          html_url: 'https://github.com/BrunaSanguini/MyLibrary/releases/tag/v1.1.0',
          assets: [
            { name, size: zip.length, browser_download_url: `${base}/dl/zip` },
            { name: `${name}.sha256`, size: 90, browser_download_url: `${base}/dl/sha` },
          ],
        }),
      );
    } else if (req.url === '/dl/zip') {
      res.writeHead(200, { 'content-length': zip.length }).end(zip);
    } else if (req.url === '/dl/sha') {
      res.writeHead(200).end(`${sha}  ${name}`);
    } else {
      res.writeHead(404).end();
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const calls: string[] = [];
  const phases: UpdateProgress['phase'][] = [];
  const logs: string[] = [];
  let active = options.running ?? true;
  const state = (status: ProcessState['status']): ProcessState => ({ id: 'livraria', status });
  const updater = new AppUpdater({
    downloadDir: path.join(root, 'downloads'),
    apiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    retryDelayMs: 10,
    isActive: () => active,
    stop: async () => {
      calls.push(
        `stop (exe: ${readFileSync(path.join(workingDir, 'MinhaLivraria.exe'), 'utf-8')})`,
      );
      active = false;
      return state('stopped');
    },
    start: async () => {
      calls.push(
        `start (exe: ${readFileSync(path.join(workingDir, 'MinhaLivraria.exe'), 'utf-8')})`,
      );
      active = true;
      return state('running');
    },
    log: (_id, line) => logs.push(line),
    progress: (_id, p) => {
      if (phases.at(-1) !== p.phase) phases.push(p.phase);
    },
  });
  const app: AppEntry = { ...MINHA_LIVRARIA.entry, id: 'livraria', folderId: '', workingDir };
  return { root, app, updater, calls, phases, logs };
}

describe('AppUpdater', () => {
  it('encontra a versão nova da Minha Livraria', async () => {
    const f = await fixture();
    expect(await f.updater.check(f.app)).toEqual({
      appId: 'livraria',
      installed: '1.0.0',
      latest: '1.1.0',
      available: true,
      releaseUrl: 'https://github.com/BrunaSanguini/MyLibrary/releases/tag/v1.1.0',
    });
  });

  it('fecha, baixa, confere, troca a pasta e abre de novo', async () => {
    const f = await fixture();
    const info = await f.updater.update(f.app);

    expect(f.calls).toEqual(['stop (exe: antigo)', 'start (exe: novo)']);
    expect(f.phases).toEqual([
      'stopping',
      'downloading',
      'verifying',
      'installing',
      'starting',
      'done',
    ]);
    expect(info).toMatchObject({ installed: '1.1.0', latest: '1.1.0', available: false });
    expect(await installedVersion(f.app.workingDir)).toBe('1.1.0');
    expect(readFileSync(path.join(f.app.workingDir, 'runtime', 'release'), 'utf-8')).toContain(
      '25',
    );
    // A versão anterior fica guardada; o zip baixado e a pasta temporária somem
    expect(
      readFileSync(path.join(`${f.app.workingDir}.anterior`, 'MinhaLivraria.exe'), 'utf-8'),
    ).toBe('antigo');
    expect(await fs.readdir(path.join(f.root, 'downloads'))).toEqual([]);
    expect(existsSync(path.join(f.root, '.MinhaLivraria-atualizacao'))).toBe(false);
  });

  it('não abre o app se ele estava fechado', async () => {
    const f = await fixture({ running: false });
    await f.updater.update(f.app);
    expect(f.calls).toEqual([]);
    expect(await installedVersion(f.app.workingDir)).toBe('1.1.0');
  });

  it('recusa um download que não confere com o .sha256 e reabre a versão que já estava', async () => {
    const f = await fixture({ checksum: 'a'.repeat(64) });
    await expect(f.updater.update(f.app)).rejects.toThrow('não confere com o SHA-256');

    expect(f.calls).toEqual(['stop (exe: antigo)', 'start (exe: antigo)']);
    expect(f.phases.at(-1)).toBe('error');
    expect(await installedVersion(f.app.workingDir)).toBe('1.0.0');
    expect(existsSync(`${f.app.workingDir}.anterior`)).toBe(false);
  });

  it('não troca a pasta se o zip não tiver o executável', async () => {
    const f = await fixture({ zip: { 'Outro/leia-me.txt': 'nada' } });
    await expect(f.updater.update(f.app)).rejects.toThrow('não tem o MinhaLivraria.exe');
    expect(readFileSync(path.join(f.app.workingDir, 'MinhaLivraria.exe'), 'utf-8')).toBe('antigo');
  });

  it('avisa quando o GitHub limita as consultas', async () => {
    const f = await fixture({ status: 403 });
    const info = await f.updater.check(f.app);
    expect(info).toMatchObject({ installed: '1.0.0', available: false });
    expect(info?.error).toContain('limitou');
  });

  it('não tem atualização para apps sem releases conhecidas', async () => {
    const f = await fixture();
    expect(await f.updater.check({ ...f.app, contract: undefined })).toBeNull();
  });
});

describe('extractZip', () => {
  it('extrai pastas e arquivos', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mc-zip-'));
    const zip = path.join(root, 'a.zip');
    await zipOf(zip, { 'A/b/c.txt': 'oi', 'A/d.txt': 'tchau' });
    await extractZip(zip, path.join(root, 'out'));
    expect(readFileSync(path.join(root, 'out', 'A', 'b', 'c.txt'), 'utf-8')).toBe('oi');
  });
});
