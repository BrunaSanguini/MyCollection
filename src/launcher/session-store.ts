import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * An app the hub started. The token is the only way to close it gracefully, so it is kept on disk:
 * if the hub is closed and opened again while the app runs, it can still close it.
 */
export interface AppSession {
  readonly appId: string;
  readonly port: number;
  readonly token: string;
  readonly pid: number;
  /** ISO 8601. */
  readonly startedAt: string;
}

/** The sessions of the running apps, in a JSON file, as the rest of the hub keeps its data. */
export class SessionStore {
  constructor(private readonly file: string) {}

  async get(appId: string): Promise<AppSession | undefined> {
    return (await this.readAll())[appId];
  }

  async save(session: AppSession): Promise<void> {
    const sessions = await this.readAll();
    sessions[session.appId] = session;
    await this.writeAll(sessions);
  }

  async remove(appId: string): Promise<void> {
    const sessions = await this.readAll();
    if (appId in sessions) {
      delete sessions[appId];
      await this.writeAll(sessions);
    }
  }

  private async readAll(): Promise<Record<string, AppSession>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, AppSession>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {};
      }
      throw error;
    }
  }

  /** Written to a side file and renamed, so a crash never leaves half a JSON behind. */
  private async writeAll(sessions: Record<string, AppSession>): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const partial = `${this.file}.tmp`;
    await writeFile(partial, JSON.stringify(sessions, null, 2), 'utf8');
    await rename(partial, this.file);
  }
}
