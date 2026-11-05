import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AppsStore } from './core/apps.store';
import { AppDialog } from './components/app-dialog/app-dialog';
import { AppGrid } from './components/app-grid/app-grid';
import { AppHero } from './components/app-hero/app-hero';
import { AppLogs } from './components/app-logs/app-logs';
import { SettingsDialog } from './components/settings-dialog/settings-dialog';
import { Sidebar } from './components/sidebar/sidebar';
import { SettingsService } from './core/settings.service';

@Component({
  selector: 'app-root',
  imports: [Sidebar, AppHero, AppLogs, AppGrid, AppDialog, SettingsDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sidebar />
    <main>
      @if (store.loadError(); as err) {
        <p class="banner" role="alert">{{ err }}</p>
      }
      @if (store.ready()) {
        <app-hero />
        @if (store.logsOpen()) { <app-logs /> }
        <app-grid />
      }
    </main>
    @if (store.dialog()) {
      <app-dialog />
    }
    @if (settings.open()) {
      <app-settings-dialog />
    }
  `,
  styles: `
    :host { display: flex; height: 100vh; overflow: hidden; }
    main {
      flex: 1 1 auto; min-width: 0; overflow-y: auto;
      box-sizing: border-box; padding: 28px 32px 40px;
      display: flex; flex-direction: column; gap: 28px;
    }
    .banner {
      margin: 0; padding: 12px 16px; border-radius: 10px;
      background: rgba(240, 100, 106, 0.12); border: 1px solid var(--mc-danger); color: var(--mc-danger);
    }
  `,
})
export class App {
  protected readonly store = inject(AppsStore);
  protected readonly settings = inject(SettingsService);
}
