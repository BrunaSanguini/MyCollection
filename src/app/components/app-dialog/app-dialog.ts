import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AppsStore } from '../../core/apps.store';
import { electronApi } from '../../core/electron-api';
import {
  AppEntry,
  AppKind,
  ICON_COLORS,
  ICON_COLOR_STYLE,
  IconColor,
  KIND_LABEL,
  OPEN_MODE_LABEL,
  OpenMode,
} from '../../core/models';
import { AppAvatar } from '../app-avatar/app-avatar';
import { Icon } from '../icon/icon';

/** Formulário de adicionar/editar app. Só é renderizado quando store.dialog() != null. */
@Component({
  selector: 'app-dialog',
  imports: [ReactiveFormsModule, Icon, AppAvatar],
  templateUrl: './app-dialog.html',
  styleUrl: './app-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'store.closeDialog()' },
})
export class AppDialog {
  protected readonly store = inject(AppsStore);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  private readonly editing: AppEntry | null;
  protected readonly title: string;

  /** Seletor de pasta nativo só existe dentro do Electron */
  protected readonly canBrowse = !!electronApi();
  protected readonly confirmDelete = signal(false);
  protected readonly isEdit: boolean;

  protected readonly colors = ICON_COLORS;
  protected readonly colorStyle = ICON_COLOR_STYLE;
  protected readonly iconError = signal<string | null>(null);

  protected readonly kinds = Object.entries(KIND_LABEL) as [AppKind, string][];
  protected readonly openModes = Object.entries(OPEN_MODE_LABEL) as [OpenMode, string][];

  protected readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    description: [''],
    kind: ['web-local' as AppKind],
    folderId: [''],
    workingDir: [''],
    command: ['', Validators.required],
    stopCommand: [''],
    url: ['', Validators.pattern(/^\s*(https?:\/\/\S+)?\s*$/i)],
    openMode: ['own-window' as OpenMode],
    icon: [''],
    color: ['blue' as IconColor],
  });

  constructor() {
    const state = this.store.dialog();
    this.editing = state && state !== 'new' ? state : null;
    this.isEdit = !!this.editing;
    this.title = this.editing ? 'Editar app' : 'Adicionar app';

    if (this.editing) {
      const { id: _id, ...values } = this.editing;
      this.form.setValue({
        ...values,
        url: values.url ?? '',
        stopCommand: values.stopCommand ?? '',
        icon: values.icon ?? '',
        color: values.color ?? 'blue',
      });
    } else {
      // Novo app entra na pasta que está aberta na sidebar (se for uma pasta)
      const view = this.store.view();
      const inFolder = this.store.folders().some((f) => f.id === view);
      this.form.patchValue({ folderId: inFolder ? view : (this.store.folders()[0]?.id ?? '') });
    }

    afterNextRender(() => this.nameInput()?.nativeElement.focus());
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.store.saveApp(
      {
        ...v,
        name: v.name.trim(),
        url: v.url.trim() || undefined,
        stopCommand: v.stopCommand.trim() || undefined,
        icon: v.icon || undefined,
      },
      this.editing?.id,
    );
  }

  protected async browse(): Promise<void> {
    const current = this.form.controls.workingDir.value.trim();
    const picked = await electronApi()?.pickFolder(current || undefined);
    if (picked) this.form.controls.workingDir.setValue(picked);
  }

  protected setColor(color: IconColor): void {
    this.form.controls.color.setValue(color);
  }

  protected async pickIcon(): Promise<void> {
    this.iconError.set(null);
    try {
      const file = await electronApi()?.pickIcon();
      if (file) this.form.controls.icon.setValue(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.iconError.set(msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  }

  protected remove(): void {
    if (!this.editing) return;
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      return;
    }
    this.store.deleteApp(this.editing.id);
  }

  protected invalid(control: 'name' | 'command' | 'url'): boolean {
    const c = this.form.controls[control];
    return c.invalid && c.touched;
  }
}
