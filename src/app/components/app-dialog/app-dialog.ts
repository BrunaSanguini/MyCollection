import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { AppsStore } from '../../core/apps.store';
import { electronApi } from '../../core/electron-api';
import {
  APP_TEMPLATES,
  AppEntry,
  AppKind,
  AppTemplate,
  DEFAULT_HUB_CONTRACT,
  TOKEN_ENV_RE,
  URL_PATH_RE,
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
  protected readonly templates = APP_TEMPLATES;
  protected readonly templateHint = signal<string | null>(null);

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
    // Contrato do hub (porta, token, readiness e shutdown) — ver shared/library.ts
    useContract: [false],
    tokenEnv: [DEFAULT_HUB_CONTRACT.tokenEnv, Validators.pattern(TOKEN_ENV_RE)],
    readinessPath: [DEFAULT_HUB_CONTRACT.readinessPath, Validators.pattern(URL_PATH_RE)],
    shutdownPath: [DEFAULT_HUB_CONTRACT.shutdownPath, Validators.pattern(URL_PATH_RE)],
  }, { validators: contractNeedsUrl });

  protected readonly useContract = toSignal(this.form.controls.useContract.valueChanges, {
    initialValue: false,
  });

  constructor() {
    const state = this.store.dialog();
    this.editing = state && state !== 'new' ? state : null;
    this.isEdit = !!this.editing;
    this.title = this.editing ? 'Editar app' : 'Adicionar app';

    if (this.editing) {
      this.fill(this.editing);
    } else {
      // Novo app entra na pasta que está aberta na sidebar (se for uma pasta)
      const view = this.store.view();
      const inFolder = this.store.folders().some((f) => f.id === view);
      this.form.patchValue({ folderId: inFolder ? view : (this.store.folders()[0]?.id ?? '') });
    }

    afterNextRender(() => this.nameInput()?.nativeElement.focus());
  }

  /** Preenche o formulário com um app (edição) ou um modelo (novo) */
  private fill(entry: Partial<AppEntry>): void {
    const contract = entry.contract;
    this.form.patchValue({
      name: entry.name ?? '',
      description: entry.description ?? '',
      kind: entry.kind ?? 'web-local',
      ...(entry.folderId !== undefined ? { folderId: entry.folderId } : {}),
      ...(entry.workingDir !== undefined ? { workingDir: entry.workingDir } : {}),
      command: entry.command ?? '',
      stopCommand: entry.stopCommand ?? '',
      url: entry.url ?? '',
      openMode: entry.openMode ?? 'own-window',
      icon: entry.icon ?? '',
      color: entry.color ?? 'blue',
      useContract: !!contract,
      ...(contract ?? DEFAULT_HUB_CONTRACT),
    });
  }

  protected applyTemplate(template: AppTemplate): void {
    this.fill(template.entry);
    this.templateHint.set(template.hint);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { useContract, tokenEnv, readinessPath, shutdownPath, ...v } = this.form.getRawValue();
    const url = v.url.trim();
    this.store.saveApp(
      {
        ...v,
        name: v.name.trim(),
        url: url || undefined,
        stopCommand: v.stopCommand.trim() || undefined,
        icon: v.icon || undefined,
        contract:
          useContract && url
            ? { tokenEnv: tokenEnv.trim(), readinessPath: readinessPath.trim(), shutdownPath: shutdownPath.trim() }
            : undefined,
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

  protected invalid(control: 'name' | 'command' | 'url' | 'tokenEnv' | 'readinessPath' | 'shutdownPath'): boolean {
    const c = this.form.controls[control];
    return c.invalid && c.touched;
  }

  protected contractWithoutUrl(): boolean {
    return !!this.form.errors?.['contractNeedsUrl'] && this.form.controls.url.touched;
  }
}

/** O hub pergunta a readiness e pede o shutdown na URL do app */
function contractNeedsUrl(group: AbstractControl): ValidationErrors | null {
  const useContract = group.get('useContract')?.value as boolean;
  const url = (group.get('url')?.value as string).trim();
  return useContract && !url ? { contractNeedsUrl: true } : null;
}
