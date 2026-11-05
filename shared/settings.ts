/** Preferências do My Collection (settings.json). Sem imports de Node/Angular. */

export interface Settings {
  version: number;
  /** Abrir o My Collection quando o Windows iniciar (só no app instalado) */
  launchAtLogin: boolean;
  /** Perguntar antes de fechar se houver apps em execução */
  confirmOnQuit: boolean;
  /** Quanto tempo esperar a URL do app responder (segundos) */
  readyTimeoutSec: number;
}

export const SETTINGS_VERSION = 1;
export const READY_TIMEOUT_MIN = 15;
export const READY_TIMEOUT_MAX = 600;

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  launchAtLogin: false,
  confirmOnQuit: true,
  readyTimeoutSec: 180,
};

export function sanitizeSettings(input: unknown): Settings {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const timeout = Number(raw['readyTimeoutSec']);
  return {
    version: SETTINGS_VERSION,
    launchAtLogin: typeof raw['launchAtLogin'] === 'boolean' ? raw['launchAtLogin'] : DEFAULT_SETTINGS.launchAtLogin,
    confirmOnQuit: typeof raw['confirmOnQuit'] === 'boolean' ? raw['confirmOnQuit'] : DEFAULT_SETTINGS.confirmOnQuit,
    readyTimeoutSec: Number.isFinite(timeout)
      ? Math.min(READY_TIMEOUT_MAX, Math.max(READY_TIMEOUT_MIN, Math.round(timeout)))
      : DEFAULT_SETTINGS.readyTimeoutSec,
  };
}
