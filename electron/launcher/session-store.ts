import { JsonFile } from '../storage/json-file';

/**
 * Um app de contrato que o hub iniciou. O token é o único jeito de fechá-lo direito, então fica
 * em disco: se o hub fechar (ou cair) com o app rodando, ao abrir de novo ele reaproveita a
 * sessão e o PARAR continua funcionando.
 */
export interface AppSession {
  appId: string;
  port: number;
  token: string;
  /** PID do processo iniciado (no Windows, o do shell que roda o comando) */
  pid: number;
  /** ISO 8601 */
  startedAt: string;
}

type Sessions = Record<string, AppSession>;

/** sessions.json, ao lado do library.json (escrita atômica do JsonFile) */
export class SessionStore {
  private readonly file: JsonFile<Sessions>;

  constructor(filePath: string) {
    this.file = new JsonFile(filePath, sanitizeSessions, () => ({}));
  }

  async get(appId: string): Promise<AppSession | undefined> {
    return (await this.file.read())[appId];
  }

  async save(session: AppSession): Promise<void> {
    const all = await this.file.read();
    await this.file.write({ ...all, [session.appId]: session });
  }

  async remove(appId: string): Promise<void> {
    const all = await this.file.read();
    if (!(appId in all)) return;
    const { [appId]: _removed, ...rest } = all;
    await this.file.write(rest);
  }
}

function sanitizeSessions(input: unknown): Sessions {
  const out: Sessions = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return out;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const s = raw as Record<string, unknown>;
    const port = Number(s['port']);
    const pid = Number(s['pid']);
    if (
      s['appId'] === key &&
      Number.isInteger(port) && port > 0 && port < 65_536 &&
      Number.isInteger(pid) && pid > 0 &&
      typeof s['token'] === 'string' && /^[0-9a-f]{16,128}$/.test(s['token']) &&
      typeof s['startedAt'] === 'string'
    ) {
      out[key] = { appId: key, port, token: s['token'], pid, startedAt: s['startedAt'] };
    }
  }
  return out;
}
