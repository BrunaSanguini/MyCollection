import { Injectable } from '@angular/core';
import type { ProcessEvent, ProcessState } from '../../../shared/process';
import { electronApi } from './electron-api';

/**
 * Execução dos apps vista pelo Angular.
 * - Electron: processos reais (ProcessManager no main)
 * - Navegador: simulação, só para desenvolver a interface
 */
@Injectable({ providedIn: 'root', useFactory: () => createProcessGateway() })
export abstract class ProcessGateway {
  abstract readonly simulated: boolean;
  abstract start(id: string): Promise<ProcessState>;
  abstract stop(id: string): Promise<ProcessState>;
  abstract open(id: string): Promise<void>;
  abstract list(): Promise<ProcessState[]>;
  abstract logs(id: string): Promise<string[]>;
  abstract clearLogs(id: string): Promise<void>;
  /** Retorna função para cancelar a inscrição */
  abstract onEvent(callback: (event: ProcessEvent) => void): () => void;
}

class ElectronProcessGateway extends ProcessGateway {
  readonly simulated = false;
  private readonly api = electronApi()!;

  start(id: string) { return this.api.startApp(id); }
  stop(id: string) { return this.api.stopApp(id); }
  open(id: string) { return this.api.openApp(id); }
  list() { return this.api.listProcesses(); }
  logs(id: string) { return this.api.getLogs(id); }
  clearLogs(id: string) { return this.api.clearLogs(id); }
  onEvent(callback: (event: ProcessEvent) => void) { return this.api.onProcessEvent(callback); }
}

class SimulatedProcessGateway extends ProcessGateway {
  readonly simulated = true;
  private readonly states = new Map<string, ProcessState>();
  private readonly logLines = new Map<string, string[]>();
  private readonly listeners = new Set<(event: ProcessEvent) => void>();

  async start(id: string): Promise<ProcessState> {
    this.set({ id, status: 'starting', startedAt: Date.now() });
    this.log(id, '▶ (simulação) iniciando — rode dentro do Electron para executar de verdade');
    setTimeout(() => {
      if (this.states.get(id)?.status !== 'starting') return;
      this.log(id, '✔ (simulação) pronto');
      this.set({ id, status: 'running', startedAt: Date.now() });
    }, 1200);
    return this.states.get(id)!;
  }

  async stop(id: string): Promise<ProcessState> {
    this.log(id, '■ (simulação) parado');
    this.set({ id, status: 'stopped' });
    return this.states.get(id)!;
  }

  async open(): Promise<void> {}
  async list() { return [...this.states.values()]; }
  async logs(id: string) { return [...(this.logLines.get(id) ?? [])]; }
  async clearLogs(id: string) { this.logLines.delete(id); }

  onEvent(callback: (event: ProcessEvent) => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private set(state: ProcessState): void {
    this.states.set(state.id, state);
    this.listeners.forEach((l) => l({ type: 'state', state }));
  }

  private log(id: string, line: string): void {
    const all = this.logLines.get(id) ?? [];
    all.push(line);
    this.logLines.set(id, all);
    this.listeners.forEach((l) => l({ type: 'log', id, lines: [line] }));
  }
}

function createProcessGateway(): ProcessGateway {
  return electronApi() ? new ElectronProcessGateway() : new SimulatedProcessGateway();
}
