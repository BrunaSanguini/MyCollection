import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

/** A process the hub started. */
export interface StartedProcess {
  readonly pid: number;
  /** Resolves with the exit code when the process ends. */
  readonly exited: Promise<number | null>;
}

/**
 * Everything the launcher asks of the operating system. The Electron main process uses the real
 * one; the tests give a fake, so no test starts a real app or opens a browser.
 */
export interface LauncherSystem {
  start(executable: string, args: readonly string[], env: Readonly<Record<string, string>>): StartedProcess;
  isAlive(pid: number): boolean;
  /** Last resort, after the graceful shutdown did not end the process. */
  forceKill(pid: number): Promise<void>;
  isPortFree(port: number): Promise<boolean>;
  /** Asks the system for any free port. */
  anyFreePort(): Promise<number>;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  openInBrowser(url: string): Promise<void>;
  newToken(): string;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

/** Listening on the port and letting it go is the only reliable way to know it is free. */
function listenOn(port: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(undefined));
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const taken = typeof address === 'object' && address ? address.port : undefined;
      server.close(() => resolve(taken));
    });
  });
}

/**
 * The real system. The browser is opened by the caller (in Electron, `shell.openExternal`), since
 * the main process is what knows the default browser of the person.
 */
export function nodeSystem(openInBrowser: (url: string) => Promise<void>): LauncherSystem {
  return {
    start(executable, args, env) {
      // Detached and without a console: the app lives on its own and the hub only holds the pid.
      const child = spawn(executable, [...args], {
        env: { ...process.env, ...env },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      const exited = new Promise<number | null>((resolve) => {
        child.once('exit', (code) => resolve(code));
        child.once('error', () => resolve(null));
      });
      child.unref();
      if (child.pid === undefined) {
        throw new Error(`Could not start ${executable}`);
      }
      return { pid: child.pid, exited };
    },
    isAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    forceKill(pid) {
      return new Promise((resolve) => {
        if (process.platform === 'win32') {
          // /T takes the JVM the launcher started along with it.
          execFile('taskkill', ['/F', '/T', '/PID', String(pid)], () => resolve());
        } else {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already gone.
          }
          resolve();
        }
      });
    },
    async isPortFree(port) {
      return (await listenOn(port)) !== undefined;
    },
    async anyFreePort() {
      const port = await listenOn(0);
      if (port === undefined) {
        throw new Error('No free port');
      }
      return port;
    },
    fetch: (url, init) => fetch(url, init),
    openInBrowser,
    newToken: () => randomBytes(32).toString('hex'),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
  };
}
