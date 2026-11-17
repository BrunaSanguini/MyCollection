import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { READY_TIMEOUT_MAX, READY_TIMEOUT_MIN } from '../../../../shared/settings';
import { AppsStore } from '../../core/apps.store';
import { SettingsService } from '../../core/settings.service';
import { Icon } from '../icon/icon';

/** Tela de Configurações (modal). */
@Component({
  selector: 'app-settings-dialog',
  imports: [Icon],
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
})
export class SettingsDialog {
  protected readonly service = inject(SettingsService);
  protected readonly store = inject(AppsStore);

  protected readonly s = this.service.settings;
  protected readonly info = this.service.info;
  protected readonly isElectron = computed(() => !!this.info());
  protected readonly canAutostart = computed(() => !!this.info()?.packaged && this.info()?.platform === 'win32');
  protected readonly min = READY_TIMEOUT_MIN;
  protected readonly max = READY_TIMEOUT_MAX;

  /** Mensagem de retorno de exportar/importar */
  protected readonly notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);
  protected readonly confirmImport = signal(false);

  close(): void {
    this.service.open.set(false);
  }

  protected toggle(key: 'launchAtLogin' | 'confirmOnQuit', event: Event): void {
    void this.service.update({ [key]: (event.target as HTMLInputElement).checked });
  }

  protected setTimeoutSec(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) void this.service.update({ readyTimeoutSec: value });
  }

  protected async exportLibrary(): Promise<void> {
    this.notice.set(null);
    try {
      const file = await this.store.exportLibrary();
      if (file) this.notice.set({ kind: 'ok', text: `Backup salvo em ${file}` });
    } catch (err) {
      this.notice.set({ kind: 'error', text: cleanError(err) });
    }
  }

  protected async importLibrary(): Promise<void> {
    if (!this.confirmImport()) {
      this.confirmImport.set(true);
      return;
    }
    this.confirmImport.set(false);
    this.notice.set(null);
    try {
      if (await this.store.importLibrary()) {
        this.notice.set({ kind: 'ok', text: `Biblioteca importada: ${this.store.apps().length} apps.` });
      }
    } catch (err) {
      this.notice.set({ kind: 'error', text: cleanError(err) });
    }
  }
}

function cleanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
