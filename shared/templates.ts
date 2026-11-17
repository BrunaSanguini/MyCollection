/**
 * Apps prontos para cadastrar no hub. Sem imports de Node/Angular.
 * O formulário vem preenchido; falta só escolher a pasta.
 */
import type { AppEntry } from './library';

export interface AppTemplate {
  label: string;
  hint: string;
  entry: Omit<AppEntry, 'id' | 'folderId' | 'workingDir'>;
}

/** Minha Livraria (github.com/BrunaSanguini/MyLibrary), pelo zip das releases */
export const MINHA_LIVRARIA: AppTemplate = {
  label: 'Minha Livraria',
  hint: 'Escolha a pasta onde extraiu o zip (a que tem o MinhaLivraria.exe).',
  entry: {
    name: 'Minha Livraria',
    description: 'Biblioteca pessoal: acervo, leituras, resenhas, listas e metas',
    kind: 'executable',
    command: 'MinhaLivraria.exe',
    url: 'http://127.0.0.1:8471/',
    openMode: 'browser',
    color: 'amber',
    contract: {
      tokenEnv: 'MINHA_LIVRARIA_SHUTDOWN_TOKEN',
      readinessPath: '/actuator/health/readiness',
      shutdownPath: '/actuator/shutdown',
    },
  },
};

export const APP_TEMPLATES: readonly AppTemplate[] = [MINHA_LIVRARIA];
