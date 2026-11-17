import { Injectable, signal } from '@angular/core';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../../shared/settings';
import { AppInfo, electronApi } from './electron-api';
import type { Settings } from './models';

const STORAGE_KEY = 'mc.settings';

/** Preferências do hub. No Electron vão para settings.json; no navegador, localStorage. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly api = electronApi();

  readonly settings = signal<Settings>({ ...DEFAULT_SETTINGS });
  readonly info = signal<AppInfo | null>(null);
  readonly open = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      if (this.api) {
        const [settings, info] = await Promise.all([this.api.getSettings(), this.api.getInfo()]);
        this.settings.set(settings);
        this.info.set(info);
      } else {
        this.settings.set(sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')));
      }
    } catch (err) {
      console.error('[settings] falha ao carregar', err);
    }
  }

  async update(patch: Partial<Settings>): Promise<void> {
    const next = sanitizeSettings({ ...this.settings(), ...patch });
    this.settings.set(next);
    this.saving.set(true);
    this.error.set(null);
    try {
      if (this.api) {
        this.settings.set(await this.api.saveSettings(next));
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
    } catch (err) {
      console.error('[settings] falha ao salvar', err);
      this.error.set('Não foi possível salvar as configurações.');
    } finally {
      this.saving.set(false);
    }
  }
}
