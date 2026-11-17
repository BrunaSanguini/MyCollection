import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { HUB_TOKEN_HEADER } from '../../shared/library';

/**
 * Peças do contrato do hub (ver HubContract em shared/library.ts), sem estado e sem Electron.
 * O ProcessManager junta essas peças ao ciclo de vida do processo.
 */

const FIRST_PAUSE_MS = 200;
const LONGEST_PAUSE_MS = 2_000;
const REQUEST_TIMEOUT_MS = 2_000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Porta da URL cadastrada (a padrão do protocolo quando não aparece) */
export function portOf(url: string): number {
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === 'https:' ? 443 : 80;
}

/** A mesma URL em outra porta e, se informado, em outro caminho */
export function withPort(url: string, port: number, path?: string): string {
  const parsed = new URL(url);
  parsed.port = String(port);
  if (path !== undefined) {
    parsed.pathname = path;
    parsed.search = '';
    parsed.hash = '';
  }
  return parsed.toString();
}

/** O comando com a porta escolhida (Spring Boot: `--server.port`) */
export function withPortArgument(command: string, port: number): string {
  return `${command.trim()} --server.port=${port}`;
}

/** Um token novo por sessão: só quem iniciou o app consegue fechá-lo */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** A porta está livre se o hub consegue ouvir nela */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

/** Qualquer porta livre, escolhida pelo sistema */
export function anyFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('Nenhuma porta livre'))));
    });
  });
}

/** Pronto = 200 com `{"status":"UP"}`. Qualquer outra resposta (ou nenhuma) é "ainda não". */
export async function isReady(readinessUrl: string, fetchFn: Fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchFn(readinessUrl, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { status?: unknown };
    return body.status === 'UP';
  } catch {
    return false;
  }
}

export type ReadinessResult = 'ready' | 'timeout' | 'aborted' | 'exited';

export interface WaitOptions {
  readinessUrl: string;
  timeoutMs: number;
  signal: AbortSignal;
  /** true quando o processo terminou antes de ficar pronto */
  exited(): boolean;
  fetch?: Fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** Pergunta a readiness com uma pausa que dobra de 200 ms até 2 s. */
export async function waitUntilReady(options: WaitOptions): Promise<ReadinessResult> {
  const fetchFn = options.fetch ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  const deadline = now() + options.timeoutMs;
  let pause = FIRST_PAUSE_MS;
  while (now() < deadline) {
    if (options.signal.aborted) return 'aborted';
    if (options.exited()) return 'exited';
    if (await isReady(options.readinessUrl, fetchFn)) {
      return options.signal.aborted ? 'aborted' : 'ready';
    }
    await sleep(pause, options.signal);
    pause = Math.min(pause * 2, LONGEST_PAUSE_MS);
  }
  return options.signal.aborted ? 'aborted' : 'timeout';
}

/**
 * Pede o encerramento com o token, sem corpo (o app recusa formulários).
 * Devolve o status HTTP, ou null se ninguém respondeu.
 */
export async function requestShutdown(
  shutdownUrl: string,
  token: string,
  fetchFn: Fetch = fetch,
): Promise<number | null> {
  try {
    const response = await fetchFn(shutdownUrl, {
      method: 'POST',
      headers: { [HUB_TOKEN_HEADER]: token },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return null;
  }
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
