import type { AppKind, IconColor, OpenMode } from '../../../shared/library';
import type { ProcessStatus } from '../../../shared/process';

// Tipos de dados vêm do arquivo compartilhado com o Electron
export type { AppEntry, AppKind, Folder, IconColor, Library, OpenMode } from '../../../shared/library';
export type { HubContract } from '../../../shared/library';
export { APP_TEMPLATES, type AppTemplate } from '../../../shared/templates';
export { DEFAULT_HUB_CONTRACT, ICON_COLORS, TOKEN_ENV_RE, URL_PATH_RE } from '../../../shared/library';
export type { Settings } from '../../../shared/settings';

export type { ProcessState, ProcessStatus as RunStatus } from '../../../shared/process';

/** Id especial para apps sem pasta */
export const NO_FOLDER = '__none__';

/** Filtro ativo da biblioteca: todos, em execução, sem pasta ou uma pasta (id) */
export type LibraryView = 'all' | 'running' | typeof NO_FOLDER | string;

export const KIND_LABEL: Record<AppKind, string> = {
  'web-local': 'Web local',
  executable: 'Executável',
  docker: 'Docker',
};

export const OPEN_MODE_LABEL: Record<OpenMode, string> = {
  'own-window': 'Janela própria',
  browser: 'Navegador',
  none: 'Não abrir',
};

export const STATUS_LABEL: Record<ProcessStatus, string> = {
  stopped: 'Parado',
  starting: 'Iniciando…',
  running: 'Em execução',
  stopping: 'Parando…',
  error: 'Erro',
};

/** Cores do ícone padrão: fundo e texto (contraste checado para texto grande) */
export const ICON_COLOR_STYLE: Record<IconColor, { bg: string; fg: string; label: string }> = {
  blue: { bg: '#1a2c47', fg: '#6cb0ff', label: 'Azul' },
  teal: { bg: '#123a3d', fg: '#4fd1c5', label: 'Turquesa' },
  green: { bg: '#16361f', fg: '#5fd38d', label: 'Verde' },
  amber: { bg: '#3a3013', fg: '#f0c04a', label: 'Âmbar' },
  orange: { bg: '#3f2415', fg: '#ff9a5a', label: 'Laranja' },
  red: { bg: '#41181c', fg: '#ff7b81', label: 'Vermelho' },
  pink: { bg: '#3e1932', fg: '#f58ac8', label: 'Rosa' },
  purple: { bg: '#2a1e47', fg: '#b49cff', label: 'Roxo' },
  slate: { bg: '#222b37', fg: '#b4c2d3', label: 'Cinza' },
};

/** URL da imagem personalizada servida pelo Electron (protocolo mc-icon) */
export function iconUrl(fileName: string): string {
  return `mc-icon://icons/${encodeURIComponent(fileName)}`;
}

export function initialsOf(name: string): string {
  const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o']);
  const all = name.trim().split(/\s+/).filter(Boolean);
  const parts = all.length > 2 ? all.filter((p) => !stop.has(p.toLowerCase())) : all;
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'item'
  );
}

export function newId(name: string): string {
  return `${slugify(name)}-${Date.now().toString(36)}`;
}
