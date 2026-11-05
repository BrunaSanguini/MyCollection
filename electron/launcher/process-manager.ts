import { ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { AppEntry } from '../../shared/library';
import { MAX_LOG_LINES, ProcessEvent, ProcessState, ProcessStatus } from '../../shared/process';

/**
 * Inicia, acompanha e para os apps cadastrados.
 * Não depende do Electron (recebe callbacks), então dá para testar com Node puro.
 *
 * Ciclo de vida:
 *   stopped → starting → running → stopping → stopped
 *                 ↘ error (comando falhou, diretório inválido, saiu com código ≠ 0)
 *
 * Dois tipos de comando:
 *  - "preso" (npm run dev, ng serve, app.exe): o processo fica vivo enquanto o app roda.
 *  - "em segundo plano" (docker compose up -d): o comando termina com código 0 e o app
 *    continua rodando fora daqui. Para esses, o PARAR usa o `stopCommand`.
 */
export interface ProcessManagerOptions {
  /** Envia eventos para a interface */
  emit(event: ProcessEvent): void;
  /** Abre o app quando ficar pronto (janela própria ou navegador) */
  open(app: AppEntry, url: string): void;
  /** Fecha janelas abertas para o app (ao parar) */
  closeWindows?(appId: string): void;
  /** Tempo máximo esperando a URL responder */
  readyTimeoutMs?: number;
  /** Intervalo entre tentativas na URL */
  pollIntervalMs?: number;
  /** Tempo até forçar o encerramento ao parar */
  stopTimeoutMs?: number;
}

interface Proc {
  app: AppEntry;
  state: ProcessState;
  child?: ChildProcess;
  /** O comando de iniciar terminou com sucesso e o app segue rodando em segundo plano */
  detached: boolean;
  stopping: boolean;
  readyAbort?: AbortController;
}

export class ProcessManager {
  private readonly procs = new Map<string, Proc>();
  private readonly logs = new Map<string, string[]>();
  private readonly pendingLogs = new Map<string, string[]>();
  private flushTimer?: NodeJS.Timeout;

  private readyTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly stopTimeoutMs: number;

  constructor(private readonly opts: ProcessManagerOptions) {
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 180_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1_000;
    this.stopTimeoutMs = opts.stopTimeoutMs ?? 8_000;
  }

  /** Atualiza o tempo máximo de espera da URL (Configurações) */
  setReadyTimeout(ms: number): void {
    this.readyTimeoutMs = ms;
  }

  // ---------------------------------------------------------------- consultas

  /** Apps com processo ativo (iniciando, rodando ou parando) */
  activeCount(): number {
    return [...this.procs.values()].filter((p) => ['starting', 'running', 'stopping'].includes(p.state.status)).length;
  }

  list(): ProcessState[] {
    return [...this.procs.values()].map((p) => ({ ...p.state }));
  }

  getLogs(id: string): string[] {
    return [...(this.logs.get(id) ?? [])];
  }

  clearLogs(id: string): void {
    this.logs.delete(id);
  }

  // ---------------------------------------------------------------- iniciar

  async start(app: AppEntry): Promise<ProcessState> {
    const current = this.procs.get(app.id);
    if (current && ['starting', 'running', 'stopping'].includes(current.state.status)) {
      return { ...current.state };
    }

    const proc: Proc = { app, state: { id: app.id, status: 'starting' }, detached: false, stopping: false };
    this.procs.set(app.id, proc);
    this.setState(proc, { status: 'starting', startedAt: Date.now() });
    this.log(app.id, `▶ Iniciando "${app.name}"`);

    // Validações antes de rodar qualquer coisa
    if (!app.command.trim()) return this.fail(proc, 'Nenhum comando de inicialização configurado.');
    const cwd = app.workingDir.trim();
    if (cwd) {
      const ok = await isDirectory(cwd);
      if (!ok) return this.fail(proc, `Diretório não encontrado: ${cwd}`);
    } else if (app.kind !== 'executable') {
      return this.fail(proc, 'Defina o "Diretório do projeto" deste app.');
    }

    if (app.url && (await isUp(app.url))) {
      this.log(app.id, `⚠ ${app.url} já está respondendo antes de iniciar — a porta pode estar em uso por outro processo.`);
    }

    this.log(app.id, `$ ${app.command}${cwd ? `   (em ${cwd})` : ''}`);
    const child = this.run(app.id, app.command, cwd || undefined);
    proc.child = child;

    child.once('spawn', () => {
      this.setState(proc, { pid: child.pid });
      if (app.url) {
        void this.waitUntilReady(proc, app.url);
      } else if (!isBackgroundStyle(app)) {
        // Sem URL para checar: considera rodando assim que o processo sobe
        this.setState(proc, { status: 'running' });
      }
    });

    child.once('error', (err) => {
      this.fail(proc, `Falha ao executar o comando: ${err.message}`);
    });

    child.once('exit', (code, signal) => {
      proc.child = undefined;
      if (proc.stopping) return; // stop() cuida do estado

      const status = proc.state.status;
      if (code === 0 && isBackgroundStyle(app) && (status === 'starting' || status === 'running')) {
        // Ex.: docker compose up -d — terminou mas o app continua rodando
        proc.detached = true;
        this.log(app.id, '✔ Comando concluído; o app segue rodando em segundo plano.');
        if (!app.url) this.setState(proc, { status: 'running', pid: undefined });
        else this.setState(proc, { pid: undefined });
        return;
      }

      proc.readyAbort?.abort();
      if (code === 0) {
        this.log(app.id, '■ Processo finalizado.');
        this.setState(proc, { status: 'stopped', pid: undefined });
      } else {
        const why = signal ? `sinal ${signal}` : `código ${code}`;
        this.fail(proc, `O processo terminou com ${why}. Veja os logs.`);
      }
    });

    return { ...proc.state };
  }

  // ---------------------------------------------------------------- parar

  async stop(id: string): Promise<ProcessState> {
    const proc = this.procs.get(id);
    if (!proc) return { id, status: 'stopped' };
    if (proc.state.status === 'stopped') return { ...proc.state };

    const app = proc.app;
    proc.stopping = true;
    proc.readyAbort?.abort();
    this.setState(proc, { status: 'stopping' });
    this.log(id, '■ Parando…');
    this.opts.closeWindows?.(id);

    if (proc.child && proc.child.exitCode === null) {
      await this.killTree(proc.child);
    }

    if (app.stopCommand?.trim()) {
      this.log(id, `$ ${app.stopCommand}`);
      const code = await this.runToEnd(id, app.stopCommand, app.workingDir.trim() || undefined);
      if (code !== 0) this.log(id, `⚠ Comando de parar terminou com código ${code}.`);
    } else if (proc.detached) {
      this.log(id, '⚠ Este app roda em segundo plano e não tem "Comando para parar" configurado.');
    }

    proc.stopping = false;
    proc.detached = false;
    this.log(id, '■ Parado.');
    this.setState(proc, { status: 'stopped', pid: undefined, url: undefined, error: undefined });
    return { ...proc.state };
  }

  /** Encerra tudo que ainda está vivo (ao fechar o My Collection). Não roda stopCommand. */
  async shutdown(): Promise<void> {
    const alive = [...this.procs.values()].filter((p) => p.child && p.child.exitCode === null);
    for (const p of alive) {
      p.stopping = true;
      p.readyAbort?.abort();
    }
    await Promise.all(alive.map((p) => this.killTree(p.child!)));
  }

  // ---------------------------------------------------------------- internos

  private run(id: string, command: string, cwd?: string): ChildProcess {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      // Em Linux/macOS cria um grupo de processos para conseguir matar a árvore inteira
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        // Impede que CLIs (CRA, Vite…) abram o navegador sozinhas — quem abre é o hub
        BROWSER: 'none',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.pipeLines(id, child.stdout);
    this.pipeLines(id, child.stderr);
    return child;
  }

  private runToEnd(id: string, command: string, cwd?: string): Promise<number> {
    return new Promise((resolve) => {
      const child = this.run(id, command, cwd);
      const timer = setTimeout(() => void this.killTree(child), 120_000);
      child.once('error', (err) => {
        this.log(id, `✖ ${err.message}`);
        clearTimeout(timer);
        resolve(-1);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });
  }

  private killTree(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.pid === undefined) return resolve();
      const pid = child.pid;
      const done = () => {
        clearTimeout(force);
        resolve();
      };
      child.once('exit', done);

      const force = setTimeout(() => {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
        } else {
          try { process.kill(-pid, 'SIGKILL'); } catch { /* já morreu */ }
        }
        setTimeout(resolve, 1_000);
      }, this.stopTimeoutMs);

      if (process.platform === 'win32') {
        // /T = processo e filhos (cmd → npm → node)
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      } else {
        try { process.kill(-pid, 'SIGTERM'); } catch { /* já morreu */ }
      }
    });
  }

  private async waitUntilReady(proc: Proc, url: string): Promise<void> {
    const abort = new AbortController();
    proc.readyAbort = abort;
    const deadline = Date.now() + this.readyTimeoutMs;
    this.log(proc.app.id, `… aguardando ${url} responder`);

    while (!abort.signal.aborted && Date.now() < deadline) {
      if (await isUp(url)) {
        if (abort.signal.aborted) return;
        this.log(proc.app.id, `✔ Pronto em ${url}`);
        this.setState(proc, { status: 'running', url });
        if (proc.app.openMode !== 'none') this.opts.open(proc.app, url);
        return;
      }
      await sleep(this.pollIntervalMs, abort.signal);
    }
    if (!abort.signal.aborted && proc.state.status === 'starting') {
      this.log(proc.app.id, `⚠ ${url} não respondeu em ${Math.round(this.readyTimeoutMs / 1000)}s. O processo continua rodando.`);
      this.setState(proc, { status: 'running' });
    }
  }

  private fail(proc: Proc, message: string): ProcessState {
    proc.readyAbort?.abort();
    this.log(proc.app.id, `✖ ${message}`);
    this.setState(proc, { status: 'error', error: message, pid: undefined });
    return { ...proc.state };
  }

  private setState(proc: Proc, patch: Partial<ProcessState> & { status?: ProcessStatus }): void {
    proc.state = { ...proc.state, ...patch };
    for (const k of Object.keys(proc.state) as (keyof ProcessState)[]) {
      if (proc.state[k] === undefined) delete proc.state[k];
    }
    if (patch.status && patch.status !== 'error') delete proc.state.error;
    this.opts.emit({ type: 'state', state: { ...proc.state } });
  }

  private pipeLines(id: string, stream: NodeJS.ReadableStream | null): void {
    if (!stream) return;
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? '';
      for (const line of parts) this.log(id, line);
    });
    stream.on('end', () => {
      if (buffer) this.log(id, buffer);
      buffer = '';
    });
  }

  private log(id: string, raw: string): void {
    const line = stripAnsi(raw).slice(0, 2000);
    const all = this.logs.get(id) ?? [];
    all.push(line);
    if (all.length > MAX_LOG_LINES) all.splice(0, all.length - MAX_LOG_LINES);
    this.logs.set(id, all);

    // Agrupa linhas e envia no máximo a cada 100 ms (evita inundar o IPC)
    const pending = this.pendingLogs.get(id) ?? [];
    pending.push(line);
    this.pendingLogs.set(id, pending);
    this.flushTimer ??= setTimeout(() => this.flush(), 100);
  }

  private flush(): void {
    this.flushTimer = undefined;
    for (const [id, lines] of this.pendingLogs) {
      this.opts.emit({ type: 'log', id, lines });
    }
    this.pendingLogs.clear();
  }
}

/** Docker e comandos com "Comando para parar" costumam rodar em segundo plano */
function isBackgroundStyle(app: AppEntry): boolean {
  return app.kind === 'docker' || !!app.stopCommand?.trim();
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Qualquer resposta HTTP (até 404/500) significa que o servidor subiu */
async function isUp(url: string): Promise<boolean> {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(1_500), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}
