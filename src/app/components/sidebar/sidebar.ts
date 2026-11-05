import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { AppsStore } from '../../core/apps.store';
import { SettingsService } from '../../core/settings.service';
import { Folder, NO_FOLDER } from '../../core/models';
import { Icon } from '../icon/icon';

@Component({
  selector: 'app-sidebar',
  imports: [Icon],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.collapsed]': 'store.sidebarCollapsed()' },
})
export class Sidebar {
  protected readonly store = inject(AppsStore);
  protected readonly settings = inject(SettingsService);
  protected readonly NO_FOLDER = NO_FOLDER;

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');
  private readonly folderInput = viewChild<ElementRef<HTMLInputElement>>('folderInput');

  /** 'new' = criando pasta; id = renomeando essa pasta; null = nada */
  protected readonly editing = signal<string | null>(null);
  protected readonly folderError = signal<string | null>(null);

  /** Ícone de busca no modo minimizado: expande e foca o campo */
  protected openSearch(): void {
    this.store.expandSidebar();
    setTimeout(() => this.searchInput()?.nativeElement.focus());
  }

  protected onQuery(event: Event): void {
    this.store.query.set((event.target as HTMLInputElement).value);
  }

  // ---- pastas
  protected startCreate(): void {
    this.store.expandSidebar();
    this.startEditing('new');
  }

  protected startRename(folder: Folder): void {
    this.startEditing(folder.id);
  }

  protected commit(value: string): void {
    const target = this.editing();
    if (!target) return;
    const error = target === 'new' ? this.store.createFolder(value) : this.store.renameFolder(target, value);
    if (error) {
      this.folderError.set(error);
      this.focusFolderInput();
      return;
    }
    this.cancel();
  }

  protected cancel(): void {
    this.editing.set(null);
    this.folderError.set(null);
  }

  protected onFolderKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit((event.target as HTMLInputElement).value);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancel();
    }
  }

  protected remove(folder: Folder): void {
    this.store.deleteFolder(folder.id);
  }

  protected count(id: string): number {
    return this.store.folderCounts()[id] ?? 0;
  }

  private startEditing(target: string): void {
    this.folderError.set(null);
    this.editing.set(target);
    this.focusFolderInput();
  }

  private focusFolderInput(): void {
    setTimeout(() => {
      const el = this.folderInput()?.nativeElement;
      el?.focus();
      el?.select();
    });
  }
}
