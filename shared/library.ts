/**
 * Tipos e validação compartilhados entre o Electron (main) e o Angular (renderer).
 * Este arquivo NÃO pode importar nada de Node nem de Angular.
 */

export const LIBRARY_VERSION = 1;

export type AppKind = 'web-local' | 'executable' | 'docker';
export type OpenMode = 'own-window' | 'browser' | 'none';

/** Cores disponíveis para o ícone padrão (iniciais) */
export const ICON_COLORS = ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'pink', 'purple', 'slate'] as const;
export type IconColor = (typeof ICON_COLORS)[number];

/** Nome de arquivo de ícone salvo em userData/icons (gerado pelo hub) */
export const ICON_FILE_RE = /^[a-z0-9-]{1,80}\.(png|jpg|jpeg|webp|gif|svg|ico)$/;

export interface Folder {
  id: string;
  name: string;
}

export interface AppEntry {
  id: string;
  name: string;
  description: string;
  kind: AppKind;
  /** '' = sem pasta */
  folderId: string;
  /** Diretório onde o comando roda (cwd) */
  workingDir: string;
  /** Comando de inicialização: `npm run dev`, `docker compose up -d`, `app.exe`… */
  command: string;
  /** Comando para parar (ex.: `docker compose down`). Necessário quando o comando de iniciar roda em segundo plano */
  stopCommand?: string;
  /** URL a abrir quando o app subir */
  url?: string;
  openMode: OpenMode;
  /** Imagem personalizada: nome do arquivo em userData/icons */
  icon?: string;
  /** Cor do ícone padrão (iniciais) */
  color?: IconColor;
}

/** Conteúdo do arquivo library.json */
export interface Library {
  version: number;
  folders: Folder[];
  apps: AppEntry[];
}

export const DEFAULT_LIBRARY: Library = {
  version: LIBRARY_VERSION,
  folders: [
    { id: 'pessoal', name: 'Pessoal' },
    { id: 'faculdade', name: 'Faculdade' },
    { id: 'trabalho', name: 'Trabalho' },
  ],
  apps: [],
};

const KINDS: readonly AppKind[] = ['web-local', 'executable', 'docker'];
const OPEN_MODES: readonly OpenMode[] = ['own-window', 'browser', 'none'];
const MAX_ITEMS = 1000;

/**
 * Valida e normaliza qualquer valor vindo de fora (arquivo editado à mão, IPC).
 * Itens inválidos são descartados; campos ausentes recebem padrão.
 * Lança erro só se a estrutura raiz for irrecuperável.
 */
export function sanitizeLibrary(input: unknown): Library {
  if (!isObject(input)) throw new Error('library: raiz não é um objeto');

  const folders: Folder[] = [];
  const folderIds = new Set<string>();
  for (const raw of asArray(input['folders']).slice(0, MAX_ITEMS)) {
    if (!isObject(raw)) continue;
    const id = str(raw['id'], 80);
    const name = str(raw['name'], 60);
    if (!id || !name || folderIds.has(id)) continue;
    folderIds.add(id);
    folders.push({ id, name });
  }

  const apps: AppEntry[] = [];
  const appIds = new Set<string>();
  for (const raw of asArray(input['apps']).slice(0, MAX_ITEMS)) {
    if (!isObject(raw)) continue;
    const id = str(raw['id'], 80);
    const name = str(raw['name'], 60);
    if (!id || !name || appIds.has(id)) continue;
    appIds.add(id);

    const kind = oneOf(raw['kind'], KINDS, 'web-local');
    const folderId = str(raw['folderId'], 80);
    const url = httpUrl(str(raw['url'], 500));
    const stopCommand = str(raw['stopCommand'], 1000);
    const icon = str(raw['icon'], 120);
    const color = oneOf<IconColor | ''>(raw['color'], ICON_COLORS, '');

    apps.push({
      id,
      name,
      description: str(raw['description'], 300),
      kind,
      folderId: folderIds.has(folderId) ? folderId : '',
      workingDir: str(raw['workingDir'], 1000),
      command: str(raw['command'], 1000),
      ...(stopCommand ? { stopCommand } : {}),
      ...(url ? { url } : {}),
      openMode: oneOf(raw['openMode'], OPEN_MODES, 'own-window'),
      ...(icon && ICON_FILE_RE.test(icon) ? { icon } : {}),
      ...(color ? { color } : {}),
    });
  }

  return { version: LIBRARY_VERSION, folders, apps };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** Só aceita http(s); qualquer outra coisa vira '' */
function httpUrl(v: string): string {
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}
