import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { type AppDefinition, minhaLivraria } from './app-definition.js';
import { AppLauncher, LaunchError } from './launcher.js';
import { SessionStore } from './session-store.js';
import type { LauncherSystem, StartedProcess } from './system.js';

const APP: AppDefinition = minhaLivraria('C:\\Apps\\MinhaLivraria\\MinhaLivraria.exe');

interface FakeApp {
  pid: number;
  port: number;
  token: string;
  /** Milliseconds of the fake clock until the readiness answers UP. */
  readyAt: number;
  alive: boolean;
  /** Leaves the shutdown unanswered, as a hung app. */
  ignoresShutdown?: boolean;
  exit?: (code: number | null) => void;
}

/** A pretend Windows: processes, ports, a browser and a clock, all in memory. */
class FakeSystem implements LauncherSystem {
  clock = 0;
  nextPid = 100;
  busyPorts = new Set<number>();
  apps: FakeApp[] = [];
  started: { executable: string; args: readonly string[]; env: Record<string, string> }[] = [];
  opened: string[] = [];
  killed: number[] = [];
  shutdowns: { port: number; token: string | undefined }[] = [];
  /** Set to make the next started app stop by itself before being ready. */
  crashOnStart: number | null | undefined;
  /** An app answering on a port that the hub did not start. */
  externalPort: number | undefined;

  start(executable: string, args: readonly string[], env: Record<string, string>): StartedProcess {
    this.started.push({ executable, args, env });
    const port = Number(args[0]?.split('=')[1]);
    const app: FakeApp = {
      pid: this.nextPid++,
      port,
      token: env[APP.tokenVariable] ?? '',
      readyAt: this.clock + 3_000,
      alive: true,
    };
    const exited = new Promise<number | null>((resolve) => (app.exit = resolve));
    this.apps.push(app);
    if (this.crashOnStart !== undefined) {
      app.alive = false;
      app.exit?.(this.crashOnStart);
    }
    return { pid: app.pid, exited };
  }

  isAlive(pid: number): boolean {
    return this.apps.some((app) => app.pid === pid && app.alive);
  }

  async forceKill(pid: number): Promise<void> {
    this.killed.push(pid);
    this.stop(pid, 1);
  }

  async isPortFree(port: number): Promise<boolean> {
    return !this.busyPorts.has(port) && !this.apps.some((app) => app.alive && app.port === port);
  }

  async anyFreePort(): Promise<number> {
    return 50_123;
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const { port, pathname } = new URL(url);
    if (Number(port) === this.externalPort && pathname === APP.readinessPath) {
      return Response.json({ status: 'UP' });
    }
    const app = this.apps.find((candidate) => candidate.alive && candidate.port === Number(port));
    if (!app) {
      throw new TypeError('fetch failed');
    }
    if (pathname === APP.readinessPath) {
      const ready = this.clock >= app.readyAt;
      return Response.json({ status: ready ? 'UP' : 'DOWN' }, { status: ready ? 200 : 503 });
    }
    if (pathname === APP.shutdownPath && init?.method === 'POST') {
      const token = new Headers(init.headers).get(APP.tokenHeader) ?? undefined;
      this.shutdowns.push({ port: app.port, token });
      if (token !== app.token) {
        return Response.json({ code: 'request.invalid-token' }, { status: 403 });
      }
      if (!app.ignoresShutdown) {
        this.stop(app.pid, 0);
      }
      return Response.json({ message: 'Shutting down, bye...' });
    }
    return new Response(null, { status: 404 });
  }

  async openInBrowser(url: string): Promise<void> {
    this.opened.push(url);
  }

  newToken(): string {
    return `token-${this.started.length + 1}`;
  }

  async sleep(ms: number): Promise<void> {
    this.clock += ms;
  }

  now(): Date {
    return new Date(Date.UTC(2026, 10, 17) + this.clock);
  }

  private stop(pid: number, code: number): void {
    const app = this.apps.find((candidate) => candidate.pid === pid);
    if (app?.alive) {
      app.alive = false;
      app.exit?.(code);
    }
  }
}

describe('AppLauncher', () => {
  let system: FakeSystem;
  let file: string;
  let sessions: SessionStore;
  let launcher: AppLauncher;

  beforeEach(() => {
    system = new FakeSystem();
    file = path.join(mkdtempSync(path.join(tmpdir(), 'hub-')), 'sessions.json');
    sessions = new SessionStore(file);
    launcher = new AppLauncher(system, sessions);
  });

  it('starts the app with its port and a new token, then opens the browser once it is ready', async () => {
    const result = await launcher.open(APP);

    expect(result.kind).toBe('started');
    expect(system.started).toEqual([
      {
        executable: APP.executable,
        args: ['--server.port=8471'],
        env: { MINHA_LIVRARIA_SHUTDOWN_TOKEN: 'token-1' },
      },
    ]);
    expect(system.clock).toBeGreaterThanOrEqual(3_000);
    expect(system.opened).toEqual(['http://127.0.0.1:8471/']);
    expect(await sessions.get(APP.id)).toMatchObject({ port: 8471, token: 'token-1', pid: 100 });
  });

  it('asks the readiness with a pause that doubles up to two seconds', async () => {
    system.start = ((original) =>
      function (this: FakeSystem, ...args: Parameters<FakeSystem['start']>) {
        const started = original.apply(this, args);
        const app = this.apps.at(-1);
        if (app) app.readyAt = 10_000;
        return started;
      })(system.start);

    await launcher.open(APP);

    // 200 + 400 + 800 + 1600 + 2000 + 2000 + 2000 + 2000 = 11 000: the first look after 10 s.
    expect(system.clock).toBe(11_000);
  });

  it('chooses another port when the default one is taken by something else', async () => {
    system.busyPorts.add(8471);

    const result = await launcher.open(APP);

    expect(system.started[0]?.args).toEqual(['--server.port=50123']);
    expect(result.kind === 'started' && result.session.port).toBe(50_123);
    expect(system.opened).toEqual(['http://127.0.0.1:50123/']);
  });

  it('does not start a second copy: it only opens the browser again', async () => {
    await launcher.open(APP);

    const again = await launcher.open(APP);

    expect(again.kind).toBe('reused');
    expect(system.started).toHaveLength(1);
    expect(system.opened).toEqual(['http://127.0.0.1:8471/', 'http://127.0.0.1:8471/']);
  });

  it('keeps the session on disk, so a hub opened again still finds and closes the app', async () => {
    await launcher.open(APP);

    const reopenedHub = new AppLauncher(system, new SessionStore(file));

    expect((await reopenedHub.open(APP)).kind).toBe('reused');
    expect(await reopenedHub.close(APP)).toBe('graceful');
    expect(system.shutdowns).toEqual([{ port: 8471, token: 'token-1' }]);
  });

  it('leaves alone a copy started outside the hub', async () => {
    system.externalPort = 8471;

    const result = await launcher.open(APP);

    expect(result).toEqual({ kind: 'external', port: 8471 });
    expect(system.started).toHaveLength(0);
    expect(await launcher.close(APP)).toBe('not-running');
  });

  it('reports an app that stops while starting and forgets its session', async () => {
    system.crashOnStart = 1;

    await expect(launcher.open(APP)).rejects.toThrow(
      new LaunchError('Minha Livraria stopped while starting (exit code 1)'),
    );
    expect(system.opened).toEqual([]);
    expect(await sessions.get(APP.id)).toBeUndefined();
  });

  it('gives up and kills an app that is never ready', async () => {
    system.start = ((original) =>
      function (this: FakeSystem, ...args: Parameters<FakeSystem['start']>) {
        const started = original.apply(this, args);
        const app = this.apps.at(-1);
        if (app) app.readyAt = Number.POSITIVE_INFINITY;
        return started;
      })(system.start);

    await expect(launcher.open(APP)).rejects.toThrow('Minha Livraria was not ready in 120 s');
    expect(system.killed).toEqual([100]);
  });

  it('closes gracefully with the token of the session', async () => {
    await launcher.open(APP);

    expect(await launcher.close(APP)).toBe('graceful');
    expect(system.shutdowns).toEqual([{ port: 8471, token: 'token-1' }]);
    expect(system.killed).toEqual([]);
    expect(await sessions.get(APP.id)).toBeUndefined();
  });

  it('kills the process only when the shutdown does not end it in time', async () => {
    await launcher.open(APP);
    const app = system.apps[0];
    if (app) app.ignoresShutdown = true;

    expect(await launcher.close(APP)).toBe('forced');
    expect(system.killed).toEqual([100]);
  });

  it('starts a new session with a new token after closing', async () => {
    await launcher.open(APP);
    await launcher.close(APP);

    const result = await launcher.open(APP);

    expect(result.kind === 'started' && result.session.token).toBe('token-2');
  });
});
