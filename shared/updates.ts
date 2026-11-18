/**
 * Atualização dos apps pelas releases do GitHub. Sem imports de Node/Angular.
 *
 * Um app atualizável publica, em cada release, um zip com a pasta do app e um `.sha256` ao lado
 * (ex.: minha-livraria-1.1.0-windows-x64.zip e minha-livraria-1.1.0-windows-x64.zip.sha256).
 */
import type { AppEntry } from './library';

export interface ReleaseSource {
  /** owner/repo no GitHub */
  repo: string;
  /** Nome do zip na release; `{version}` vira a versão (sem o "v") */
  asset: string;
}

/** Minha Livraria: as releases de github.com/BrunaSanguini/MyLibrary */
export const MINHA_LIVRARIA_RELEASES: ReleaseSource = {
  repo: 'BrunaSanguini/MyLibrary',
  asset: 'minha-livraria-{version}-windows-x64.zip',
};

const MINHA_LIVRARIA_TOKEN_ENV = 'MINHA_LIVRARIA_SHUTDOWN_TOKEN';

/**
 * De onde vêm as versões do app. Os apps cadastrados pelo modelo da Minha Livraria são
 * reconhecidos pelo contrato, sem precisar mexer no library.json de quem já tem o app.
 */
export function releaseSourceOf(app: AppEntry): ReleaseSource | undefined {
  if (app.kind !== 'executable' || !app.workingDir) return undefined;
  return app.contract?.tokenEnv === MINHA_LIVRARIA_TOKEN_ENV ? MINHA_LIVRARIA_RELEASES : undefined;
}

export function assetName(source: ReleaseSource, version: string): string {
  return source.asset.replace('{version}', version);
}

/** "v1.10.0" → [1, 10, 0]; undefined se não for uma versão x.y.z */
function partsOf(version: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? match.slice(1).map(Number) : undefined;
}

/** true quando `latest` é uma versão maior que `installed` (versões fora do padrão: false) */
export function isNewer(latest: string, installed: string): boolean {
  const a = partsOf(latest);
  const b = partsOf(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export function cleanVersion(version: string): string {
  return version.trim().replace(/^v/, '');
}

/** O que o hub sabe das versões de um app */
export interface UpdateInfo {
  appId: string;
  /** Versão na pasta do app (undefined se não deu para ler) */
  installed?: string;
  /** Última release publicada */
  latest?: string;
  available: boolean;
  /** Página da release, para ler as novidades */
  releaseUrl?: string;
  /** Falha ao consultar (sem internet, limite do GitHub…) */
  error?: string;
}

export type UpdatePhase =
  'stopping' | 'downloading' | 'verifying' | 'installing' | 'starting' | 'done' | 'error';

export interface UpdateProgress {
  phase: UpdatePhase;
  version: string;
  /** 0–100, só no download */
  percent?: number;
  /** Mensagem do erro (phase 'error') */
  error?: string;
}

export const UPDATE_PHASE_LABEL: Record<UpdatePhase, string> = {
  stopping: 'Fechando o app…',
  downloading: 'Baixando',
  verifying: 'Conferindo o arquivo…',
  installing: 'Instalando…',
  starting: 'Abrindo de novo…',
  done: 'Atualizado',
  error: 'Falhou',
};
