/**
 * Contrato de execução de apps entre Electron (main) e Angular (renderer).
 * Sem imports de Node/Angular.
 */
import type { UpdateProgress } from './updates';

export type ProcessStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface ProcessState {
  id: string;
  status: ProcessStatus;
  /** PID do processo principal (quando há um processo vivo) */
  pid?: number;
  startedAt?: number;
  /** Mensagem do último erro (status 'error') */
  error?: string;
  /** URL que o app respondeu (pronto para abrir) */
  url?: string;
}

export type ProcessEvent =
  | { type: 'state'; state: ProcessState }
  | { type: 'log'; id: string; lines: string[] }
  | { type: 'update'; id: string; progress: UpdateProgress };

/** Linhas guardadas por app (as mais antigas são descartadas) */
export const MAX_LOG_LINES = 1000;
