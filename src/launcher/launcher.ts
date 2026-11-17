import type { AppDefinition } from './app-definition.js';
import type { AppSession, SessionStore } from './session-store.js';
import type { LauncherSystem, StartedProcess } from './system.js';

const FIRST_PAUSE_MS = 200;
const LONGEST_PAUSE_MS = 2_000;
const REQUEST_TIMEOUT_MS = 2_000;

export type OpenResult =
  /** Started now. */
  | { readonly kind: 'started'; readonly session: AppSession }
  /** Was already running from a session of the hub: only the browser was opened. */
  | { readonly kind: 'reused'; readonly session: AppSession }
  /** Something already answers on the port of the app, started outside the hub. */
  | { readonly kind: 'external'; readonly port: number };

export type CloseResult = 'graceful' | 'forced' | 'not-running';

export class LaunchError extends Error {
  override readonly name = 'LaunchError';
}

/**
 * Starts and closes the local apps by the contract of the hub (see AppDefinition).
 *
 * - **One copy at a time.** Before starting, the hub asks the readiness of the session it saved
 *   and of the default port. If the app answers, it only opens the browser.
 * - **Port.** The default one when free; any free port otherwise.
 * - **Token.** A new random token per session, given by environment variable and kept with the
 *   session, so only this hub can close the app.
 * - **Readiness.** Asked with a pause that doubles up to 2 s, until UP, the startup timeout, or the
 *   process ending first.
 * - **Closing.** The graceful shutdown with the token, so the app closes its database; killing the
 *   process is the last resort, after the shutdown timeout.
 */
export class AppLauncher {
  constructor(
    private readonly system: LauncherSystem,
    private readonly sessions: SessionStore,
  ) {}

  async open(app: AppDefinition): Promise<OpenResult> {
    const saved = await this.sessions.get(app.id);
    if (saved && this.system.isAlive(saved.pid) && (await this.isReady(app, saved.port))) {
      await this.system.openInBrowser(this.urlOf(saved.port, app.homePath));
      return { kind: 'reused', session: saved };
    }
    if (saved) {
      await this.sessions.remove(app.id);
    }
    if (await this.isReady(app, app.defaultPort)) {
      await this.system.openInBrowser(this.urlOf(app.defaultPort, app.homePath));
      return { kind: 'external', port: app.defaultPort };
    }

    const port = (await this.system.isPortFree(app.defaultPort))
      ? app.defaultPort
      : await this.system.anyFreePort();
    const token = this.system.newToken();
    const process = this.system.start(app.executable, [`--server.port=${port}`], {
      [app.tokenVariable]: token,
    });
    const session: AppSession = {
      appId: app.id,
      port,
      token,
      pid: process.pid,
      startedAt: this.system.now().toISOString(),
    };
    await this.sessions.save(session);

    try {
      await this.waitUntilReady(app, port, process);
    } catch (error) {
      await this.sessions.remove(app.id);
      if (this.system.isAlive(process.pid)) {
        await this.system.forceKill(process.pid);
      }
      throw error;
    }
    await this.system.openInBrowser(this.urlOf(port, app.homePath));
    return { kind: 'started', session };
  }

  async close(app: AppDefinition): Promise<CloseResult> {
    const session = await this.sessions.get(app.id);
    if (!session || !this.system.isAlive(session.pid)) {
      await this.sessions.remove(app.id);
      return 'not-running';
    }
    try {
      await this.system.fetch(this.urlOf(session.port, app.shutdownPath), {
        method: 'POST',
        headers: { [app.tokenHeader]: session.token },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Unanswered: the wait below ends in the last resort.
    }
    // A refused shutdown (wrong token, app too old) also ends there: the process does not stop.
    const stopped = await this.waitForExit(session.pid, app.shutdownTimeoutMs);
    if (!stopped) {
      await this.system.forceKill(session.pid);
    }
    await this.sessions.remove(app.id);
    return stopped ? 'graceful' : 'forced';
  }

  private async waitUntilReady(app: AppDefinition, port: number, process: StartedProcess): Promise<void> {
    const deadline = this.system.now().getTime() + app.startupTimeoutMs;
    let ended: number | null | undefined;
    void process.exited.then((code) => (ended = code));
    let pause = FIRST_PAUSE_MS;
    while (this.system.now().getTime() < deadline) {
      if (ended !== undefined) {
        throw new LaunchError(`${app.name} stopped while starting (exit code ${ended})`);
      }
      if (await this.isReady(app, port)) {
        return;
      }
      await this.system.sleep(pause);
      pause = Math.min(pause * 2, LONGEST_PAUSE_MS);
    }
    throw new LaunchError(`${app.name} was not ready in ${app.startupTimeoutMs / 1000} s`);
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = this.system.now().getTime() + timeoutMs;
    while (this.system.now().getTime() < deadline) {
      if (!this.system.isAlive(pid)) {
        return true;
      }
      await this.system.sleep(FIRST_PAUSE_MS);
    }
    return !this.system.isAlive(pid);
  }

  private async isReady(app: AppDefinition, port: number): Promise<boolean> {
    try {
      const response = await this.system.fetch(this.urlOf(port, app.readinessPath), {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return response.ok && ((await response.json()) as { status?: string }).status === 'UP';
    } catch {
      return false;
    }
  }

  private urlOf(port: number, path: string): string {
    return `http://127.0.0.1:${port}${path}`;
  }
}
