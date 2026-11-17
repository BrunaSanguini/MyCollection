import type { ProcessEvent, ProcessState } from '../../../shared/process';
import type { Settings } from '../../../shared/settings';
import type { Library } from './models';

/** Contrato exposto pelo electron/preload.ts em `window.myCollection`. */
export interface AppInfo {
  version: string;
  platform: string;
  electron: string;
  /** true no app instalado (empacotado) */
  packaged: boolean;
  dataFile: string;
}

export interface MyCollectionApi {
  getInfo(): Promise<AppInfo>;
  loadLibrary(): Promise<Library>;
  /** Retorna a biblioteca como ficou salva (já validada pelo main) */
  saveLibrary(library: Library): Promise<Library>;
  revealDataFile(): Promise<void>;
  /** Abre o seletor de pastas do sistema; null se cancelado */
  pickFolder(defaultPath?: string): Promise<string | null>;
  /** Salva um backup; retorna o caminho ou null se cancelado */
  exportLibrary(): Promise<string | null>;
  /** Substitui a biblioteca por um backup; null se cancelado */
  importLibrary(): Promise<Library | null>;

  // Configurações e ícones
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<Settings>;
  /** Abre o seletor de imagem e copia para a pasta de ícones; retorna o nome do arquivo */
  pickIcon(): Promise<string | null>;

  // Execução
  startApp(id: string): Promise<ProcessState>;
  stopApp(id: string): Promise<ProcessState>;
  openApp(id: string): Promise<void>;
  listProcesses(): Promise<ProcessState[]>;
  getLogs(id: string): Promise<string[]>;
  clearLogs(id: string): Promise<void>;
  onProcessEvent(callback: (event: ProcessEvent) => void): () => void;
}

declare global {
  interface Window {
    myCollection?: MyCollectionApi;
  }
}

/** `undefined` quando o Angular roda fora do Electron (ex.: só `ng serve` no navegador). */
export function electronApi(): MyCollectionApi | undefined {
  return typeof window !== 'undefined' ? window.myCollection : undefined;
}
