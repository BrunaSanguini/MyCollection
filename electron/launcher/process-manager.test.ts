import { existsSync, mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppEntry } from '../../shared/library';
import type { ProcessEvent, ProcessState, ProcessStatus } from '../../shared/process';
import { anyFreePort, isReady } from './hub-contract';
import { ProcessManager } from './process-manager';
import { SessionStore } from './session-store';

/**
 * O ProcessManager com um app de verdade (test/contract-app.cjs) que segue o contrato do hub:
 * porta por argumento, token por variável de ambiente, readiness e shutdown por HTTP.
 */
const FAKE_APP = path.join(__dirname, 'test', 'contract-app.cjs');

interface Harness {
  manager: ProcessManager;
  opened: string[];
  events: ProcessEvent[];
  logs(id: string): string;
}

const managers: ProcessManager[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.shutdown()));
  for (const s of servers.splice(0)) s.close();
});

function harness(sessions: SessionStore, contractStopTimeoutMs = 10_000): Harness {
  const opened: string[] = [];
  const events: ProcessEvent[] = [];
  const manager = new ProcessManager({
    emit: (event) => events.push(event),
    open: (_app, url) => opened.push(url),
    readyTimeoutMs: 20_000,
    contractStopTimeoutMs,
    sessions,
  });
  managers.push(manager);
  return { manager, opened, events, logs: (id) => manager.getLogs(id).join('\n') };
}

function newSessions(): { store: SessionStore; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-pm-'));
  return { store: new SessionStore(path.join(dir, 'sessions.json')), dir };
}

function contractApp(port: number, extraArgs = ''): AppEntry {
  return {
    id: 'livraria',
    name: 'Livraria de teste',
    description: '',
    kind: 'executable',
    folderId: '',
    workingDir: '',
    command: `"${process.execPath}" "${FAKE_APP}" ${extraArgs}`.trim(),
    url: `http://127.0.0.1:${port}/`,
    openMode: 'browser',
    contract: {
      tokenEnv: 'TEST_APP_TOKEN',
      readinessPath: '/actuator/health/readiness',
      shutdownPath: '/actuator/shutdown',
    },
  };
}

async function waitFor(
  manager: ProcessManager,
  id: string,
  status: ProcessStatus,
  timeoutMs = 20_000,
): Promise<ProcessState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = manager.list().find((s) => s.id === id);
    if (state?.status === status) return state;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`não chegou em ${status}: ${JSON.stringify(manager.list())}\n${manager.getLogs(id).join('\n')}`);
}

async function occupy(port: number): Promise<void> {
  const server = createServer().listen(port, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
}

describe('ProcessManager com o contrato do hub', () => {
  it('inicia na porta da URL, espera a readiness, abre e fecha pelo shutdown', async () => {
    const { store, dir } = newSessions();
    const h = harness(store);
    const port = await anyFreePort();
    const marker = path.join(dir, 'fechou.txt');
    const app = contractApp(port, `--marker="${marker}"`);

    await h.manager.start(app);
    const running = await waitFor(h.manager, app.id, 'running');
    expect(running.url).toBe(`http://127.0.0.1:${port}/`);
    expect(h.opened).toEqual([`http://127.0.0.1:${port}/`]);
    expect(h.logs(app.id)).toContain(`--server.port=${port}`);
    expect((await store.get(app.id))?.port).toBe(port);

    const stopped = await h.manager.stop(app.id);
    expect(stopped.status).toBe('stopped');
    expect(existsSync(marker)).toBe(true); // fechou pelo próprio app, não à força
    expect(h.logs(app.id)).toContain('O app fechou sozinho');
    expect(await store.get(app.id)).toBeUndefined();
  });

  it('usa outra porta quando a da URL está ocupada', async () => {
    const { store } = newSessions();
    const h = harness(store);
    const busy = await anyFreePort();
    await occupy(busy);
    const app = contractApp(busy);

    await h.manager.start(app);
    const running = await waitFor(h.manager, app.id, 'running');
    expect(running.url).not.toBe(`http://127.0.0.1:${busy}/`);
    expect(h.logs(app.id)).toContain(`A porta ${busy} está ocupada`);
    await h.manager.stop(app.id);
  });

  it('reaproveita o app de uma sessão anterior do hub e ainda consegue fechá-lo', async () => {
    const { store, dir } = newSessions();
    const port = await anyFreePort();
    const marker = path.join(dir, 'fechou.txt');
    const app = contractApp(port, `--marker="${marker}"`);

    const first = harness(store);
    await first.manager.start(app);
    await waitFor(first.manager, app.id, 'running');

    // Um hub novo (o anterior caiu sem fechar o app) só tem o sessions.json
    const second = harness(store);
    await second.manager.start(app);
    const adopted = await waitFor(second.manager, app.id, 'running');
    expect(adopted.url).toBe(`http://127.0.0.1:${port}/`);
    expect(second.logs(app.id)).toContain('sessão anterior do hub');
    expect(second.logs(app.id)).not.toContain('$ ');

    await second.manager.stop(app.id);
    expect(existsSync(marker)).toBe(true);
    expect(await isReady(`http://127.0.0.1:${port}/actuator/health/readiness`)).toBe(false);
  });

  it('não inicia uma segunda cópia quando já há uma aberta fora do hub', async () => {
    const outside = newSessions();
    const port = await anyFreePort();
    const app = contractApp(port);
    const other = harness(outside.store);
    await other.manager.start(app);
    await waitFor(other.manager, app.id, 'running');

    const h = harness(newSessions().store);
    const state = await h.manager.start(app);
    expect(state.status).toBe('error');
    expect(state.error).toContain('aberta fora do My Collection');
  });

  it('encerra à força se o app aceitar o pedido mas não fechar', async () => {
    const { store } = newSessions();
    const h = harness(store, 1_500);
    const app = contractApp(await anyFreePort(), '--ignore-shutdown');

    await h.manager.start(app);
    await waitFor(h.manager, app.id, 'running');
    const stopped = await h.manager.stop(app.id);
    expect(stopped.status).toBe('stopped');
    expect(h.logs(app.id)).toContain('encerrando o processo à força');
  });

  it('ao fechar o hub, fecha os apps de contrato pelo shutdown', async () => {
    const { store, dir } = newSessions();
    const h = harness(store);
    const marker = path.join(dir, 'fechou.txt');
    const app = contractApp(await anyFreePort(), `--marker="${marker}"`);

    await h.manager.start(app);
    await waitFor(h.manager, app.id, 'running');
    await h.manager.shutdown();
    expect(existsSync(marker)).toBe(true);
  });
});
