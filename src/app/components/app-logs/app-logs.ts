import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { AppsStore } from '../../core/apps.store';
import { Icon } from '../icon/icon';

/** Painel de logs do app selecionado (estilo terminal). */
@Component({
  selector: 'app-logs',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.selected(); as app) {
      <section class="panel" aria-label="Logs">
        <header>
          <app-icon name="terminal" [size]="16" />
          <h2>Logs · {{ app.name }}</h2>
          <span class="count">{{ store.selectedLogs().length }} linhas</span>
          <span class="grow"></span>
          <button type="button" (click)="store.clearLogs(app.id)">Limpar</button>
          <button type="button" (click)="store.toggleLogs()" aria-label="Fechar logs">
            <app-icon name="close" [size]="16" />
          </button>
        </header>
        <pre #output tabindex="0" (scroll)="onScroll()">@for (line of store.selectedLogs(); track $index) {<span [class]="lineClass(line)">{{ line }}</span>
}@empty {<span class="muted">Sem saída ainda. Clique em INICIAR para ver os logs aqui.</span>}</pre>
      </section>
    }
  `,
  styles: `
    .panel {
      display: flex; flex-direction: column;
      background: #070b11; border: 1px solid var(--mc-border-hero); border-radius: 14px; overflow: hidden;
    }
    header {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      background: var(--mc-surface); border-bottom: 1px solid var(--mc-border-soft); color: var(--mc-muted);
    }
    h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--mc-text); }
    .count { font-size: 12px; }
    .grow { flex-grow: 1; }
    header button {
      display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px;
      border: 1px solid var(--mc-border); border-radius: 8px; background: transparent;
      color: #c5d2e2; font: inherit; font-size: 13px; cursor: pointer;
      &:hover { background: var(--mc-hover); }
    }
    pre {
      margin: 0; padding: 12px 14px; height: 280px; overflow: auto;
      font-family: ui-monospace, Consolas, 'Cascadia Mono', monospace; font-size: 12.5px; line-height: 1.5;
      color: #c9d4e1; white-space: pre-wrap; word-break: break-word;
      &:focus-visible { outline: 2px solid var(--mc-accent); outline-offset: -2px; }
    }
    .sys { color: var(--mc-accent-text); }
    .ok { color: var(--mc-ok); }
    .warn { color: var(--mc-warn); }
    .err { color: var(--mc-danger); }
    .muted { color: var(--mc-muted); }
  `,
})
export class AppLogs {
  protected readonly store = inject(AppsStore);
  private readonly output = viewChild<ElementRef<HTMLPreElement>>('output');
  /** Rola sozinho enquanto o usuário estiver no fim */
  private stickToBottom = true;

  constructor() {
    // Ao trocar de app selecionado, carrega o histórico de logs dele
    effect(() => {
      const id = this.store.selected()?.id;
      if (id) untracked(() => void this.store.loadLogs(id));
      this.stickToBottom = true;
    });

    afterRenderEffect(() => {
      this.store.selectedLogs();
      const el = this.output()?.nativeElement;
      if (el && this.stickToBottom) el.scrollTop = el.scrollHeight;
    });
  }

  protected onScroll(): void {
    const el = this.output()?.nativeElement;
    if (!el) return;
    this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  protected lineClass(line: string): string {
    if (line.startsWith('✖') || /\b(error|erro|failed|falha)\b/i.test(line)) return 'err';
    if (line.startsWith('⚠') || /\bwarn(ing)?\b/i.test(line)) return 'warn';
    if (line.startsWith('✔')) return 'ok';
    if (line.startsWith('▶') || line.startsWith('■') || line.startsWith('$') || line.startsWith('…')) return 'sys';
    return '';
  }
}
