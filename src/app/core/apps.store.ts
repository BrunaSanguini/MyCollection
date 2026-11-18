import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { LIBRARY_VERSION } from '../../../shared/library';
import { MAX_LOG_LINES, ProcessEvent } from '../../../shared/process';
import type { UpdateInfo, UpdateProgress } from '../../../shared/updates';
import { electronApi } from './electron-api';
import { LibraryGateway } from './library.gateway';
import { AppEntry, Folder, LibraryView, NO_FOLDER, ProcessState, RunStatus, newId } from './models';
import { ProcessGateway } from './process.gateway';

/** Valor do diálogo de app: null = fechado, 'new' = criar, AppEntry = editar */
export type DialogState = null | 'new' | AppEntry;

const SIDEBAR_KEY = 'mc.sidebarCollapsed';

/**
 * Estado central da tela (signals).
 * - Apps e pastas: persistidos via LibraryGateway (library.json no Electron)
 * - Execução: ProcessGateway (processos reais no Electron, simulação no navegador)
 */
@Injectable({ providedIn: 'root' })
export class AppsStore {
  private readonly gateway = inject(LibraryGateway);
  private readonly processGateway = inject(ProcessGateway);

  // ---- estado persistido
  readonly folders = signal<Folder[]>([]);
  readonly apps = signal<AppEntry[]>([]);

  // ---- estado de sessão
  readonly ready = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly processes = signal<Record<string, ProcessState>>({});
  readonly logs = signal<Record<string, string[]>>({});
  readonly logsOpen = signal(false);
  readonly simulated = this.processGateway.simulated;
  readonly selectedId = signal<string>('');
  readonly view = signal<LibraryView>('all');
  readonly query = signal('');
  readonly sidebarCollapsed = signal(readBool(SIDEBAR_KEY));
  readonly dialog = signal<DialogState>(null);
  readonly storageKind = this.gateway.kind;
  /** Versões dos apps atualizáveis (só os que têm releases conhecidas, ex.: Minha Livraria) */
  readonly updates = signal<Record<string, UpdateInfo>>({});
  /** Andamento da atualização em curso de cada app */
  readonly updateProgress = signal<Record<string, UpdateProgress>>({});
  readonly updateError = signal<Record<string, string>>({});

  private saveChain: Promise<unknown> = Promise.resolve();

  constructor() {
    const unsubscribe = this.processGateway.onEvent((e) => this.onProcessEvent(e));
    inject(DestroyRef).onDestroy(unsubscribe);
    void this.init();
  }

  // ---- derivados
  readonly selected = computed<AppEntry | null>(
    () => this.apps().find((a) => a.id === this.selectedId()) ?? this.apps()[0] ?? null,
  );

  readonly runningCount = computed(
    () => Object.values(this.processes()).filter((p) => isActive(p.status)).length,
  );

  readonly selectedLogs = computed(() => {
    const id = this.selected()?.id;
    return id ? (this.logs()[id] ?? []) : [];
  });

  readonly folderCounts = computed(() => {
    const counts: Partial<Record<string, number>> = {};
    for (const a of this.apps()) {
      const key = a.folderId || NO_FOLDER;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  });

  readonly noFolderCount = computed(() => this.folderCounts()[NO_FOLDER] ?? 0);

  readonly viewTitle = computed(() => {
    const v = this.view();
    if (v === 'all') return 'Todos os apps';
    if (v === 'running') return 'Em execução';
    if (v === NO_FOLDER) return 'Sem pasta';
    return this.folders().find((f) => f.id === v)?.name ?? 'Pasta';
  });

  readonly filteredApps = computed(() => {
    const v = this.view();
    const q = this.query().trim().toLowerCase();
    const procs = this.processes();
    return this.apps().filter((a) => {
      if (v === 'running' && !isActive(procs[a.id]?.status ?? 'stopped')) return false;
      if (v === NO_FOLDER && a.folderId !== '') return false;
      if (v !== 'all' && v !== 'running' && v !== NO_FOLDER && a.folderId !== v) return false;
      return !q || a.name.toLowerCase().includes(q);
    });
  });

  // ---- carga
  private async init(): Promise<void> {
    try {
      const lib = await this.gateway.load();
      this.folders.set(lib.folders);
      this.apps.set(lib.apps);
      this.selectedId.set(lib.apps[0]?.id ?? '');
      // Processos que já estavam rodando (ex.: a janela foi recarregada)
      const running = await this.processGateway.list();
      this.processes.set(Object.fromEntries(running.map((p) => [p.id, p])));
      // Procura versões novas em segundo plano; sem internet, só não aparece o botão
      for (const app of lib.apps) void this.checkUpdate(app.id);
    } catch (err) {
      console.error('[store] falha ao carregar biblioteca', err);
      this.loadError.set('Não foi possível carregar seus apps. Veja o console para detalhes.');
    } finally {
      this.ready.set(true);
    }
  }

  // ---- backup
  /** Retorna o caminho salvo, ou null se cancelado/indisponível */
  async exportLibrary(): Promise<string | null> {
    await this.saveChain;
    return (await electronApi()?.exportLibrary()) ?? null;
  }

  /** Substitui tudo pelo backup escolhido. Retorna true se importou. */
  async importLibrary(): Promise<boolean> {
    await this.saveChain;
    const lib = await electronApi()?.importLibrary();
    if (!lib) return false;
    this.folders.set(lib.folders);
    this.apps.set(lib.apps);
    this.selectedId.set(lib.apps[0]?.id ?? '');
    this.view.set('all');
    this.logs.set({});
    return true;
  }

  revealDataFile(): void {
    void electronApi()?.revealDataFile();
  }

  /** Salva o estado atual. Saves são enfileirados para manter a ordem. */
  private persist(): void {
    const snapshot = { version: LIBRARY_VERSION, folders: this.folders(), apps: this.apps() };
    this.saveChain = this.saveChain
      .then(() => this.gateway.save(snapshot))
      .then(() => this.saveError.set(null))
      .catch((err: unknown) => {
        console.error('[store] falha ao salvar', err);
        this.saveError.set('Não foi possível salvar a última alteração.');
      });
  }

  // ---- UI
  select(id: string): void {
    this.selectedId.set(id);
  }

  setView(view: LibraryView): void {
    this.view.set(view);
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update((c) => !c);
    writeBool(SIDEBAR_KEY, this.sidebarCollapsed());
  }

  expandSidebar(): void {
    this.sidebarCollapsed.set(false);
    writeBool(SIDEBAR_KEY, false);
  }

  statusOf(id: string): RunStatus {
    return this.processes()[id]?.status ?? 'stopped';
  }

  processOf(id: string): ProcessState | undefined {
    return this.processes()[id];
  }

  folderName(id: string): string {
    if (!id) return 'Sem pasta';
    return this.folders().find((f) => f.id === id)?.name ?? 'Sem pasta';
  }

  // ---- apps
  openNew(): void {
    this.dialog.set('new');
  }

  openEdit(app: AppEntry): void {
    this.dialog.set(app);
  }

  closeDialog(): void {
    this.dialog.set(null);
  }

  saveApp(entry: Omit<AppEntry, 'id'>, id?: string): void {
    let savedId = id;
    if (id) {
      this.apps.update((list) => list.map((a) => (a.id === id ? { ...entry, id } : a)));
    } else {
      const created = { ...entry, id: newId(entry.name) };
      savedId = created.id;
      this.apps.update((list) => [...list, created]);
      this.selectedId.set(created.id);
      this.view.set('all');
    }
    this.dialog.set(null);
    this.persist();
    // A pasta pode ter mudado: a versão instalada é lida de novo depois de salvar
    if (savedId) void this.saveChain.then(() => this.checkUpdate(savedId));
  }

  deleteApp(id: string): void {
    if (isActive(this.statusOf(id))) void this.processGateway.stop(id);
    this.apps.update((list) => list.filter((a) => a.id !== id));
    if (this.selectedId() === id) this.selectedId.set(this.apps()[0]?.id ?? '');
    this.dialog.set(null);
    this.persist();
  }

  // ---- pastas
  /** Retorna mensagem de erro ou null se ok */
  createFolder(name: string): string | null {
    const clean = name.trim();
    const error = this.validateFolderName(clean);
    if (error) return error;
    const folder = { id: newId(clean), name: clean };
    this.folders.update((list) => [...list, folder]);
    this.view.set(folder.id);
    this.persist();
    return null;
  }

  renameFolder(id: string, name: string): string | null {
    const clean = name.trim();
    const error = this.validateFolderName(clean, id);
    if (error) return error;
    this.folders.update((list) => list.map((f) => (f.id === id ? { ...f, name: clean } : f)));
    this.persist();
    return null;
  }

  /** Só exclui pasta vazia — evita apagar apps sem querer */
  deleteFolder(id: string): boolean {
    if ((this.folderCounts()[id] ?? 0) > 0) return false;
    this.folders.update((list) => list.filter((f) => f.id !== id));
    if (this.view() === id) this.view.set('all');
    this.persist();
    return true;
  }

  private validateFolderName(name: string, ignoreId?: string): string | null {
    if (!name) return 'Informe um nome.';
    if (name.length > 60) return 'Máximo de 60 caracteres.';
    const exists = this.folders().some(
      (f) => f.id !== ignoreId && f.name.toLowerCase() === name.toLowerCase(),
    );
    return exists ? 'Já existe uma pasta com esse nome.' : null;
  }

  // ---- execução
  async start(id: string): Promise<void> {
    if (isActive(this.statusOf(id))) return;
    // Garante que a última edição já está no arquivo (o main lê o comando de lá)
    await this.saveChain;
    try {
      this.mergeState(await this.processGateway.start(id));
    } catch (err) {
      this.mergeState({ id, status: 'error', error: errorMessage(err) });
    }
  }

  async stop(id: string): Promise<void> {
    try {
      this.mergeState(await this.processGateway.stop(id));
    } catch (err) {
      this.mergeState({ id, status: 'error', error: errorMessage(err) });
    }
  }

  // ---- atualização
  async checkUpdate(id: string): Promise<void> {
    try {
      const info = await this.processGateway.checkUpdate(id);
      this.updates.update((all) => {
        const { [id]: _, ...rest } = all;
        return info ? { ...rest, [id]: info } : rest;
      });
    } catch (err) {
      console.warn('[store] não deu para procurar atualização', err);
    }
  }

  isUpdating(id: string): boolean {
    const phase = this.updateProgress()[id]?.phase;
    return phase !== undefined && phase !== 'done' && phase !== 'error';
  }

  async update(id: string): Promise<void> {
    if (this.isUpdating(id)) return;
    this.updateError.update(({ [id]: _, ...rest }) => rest);
    const version = this.updates()[id]?.latest ?? '';
    this.updateProgress.update((all) => ({ ...all, [id]: { phase: 'stopping', version } }));
    try {
      const info = await this.processGateway.update(id);
      if (info) this.updates.update((all) => ({ ...all, [id]: info }));
    } catch (err) {
      this.updateError.update((all) => ({ ...all, [id]: errorMessage(err) }));
    } finally {
      this.updateProgress.update(({ [id]: _, ...rest }) => rest);
    }
  }

  toggleRun(id: string): void {
    const s = this.statusOf(id);
    if (s === 'stopping') return;
    void (s === 'starting' || s === 'running' ? this.stop(id) : this.start(id));
  }

  openApp(id: string): void {
    void this.processGateway.open(id);
  }

  toggleLogs(): void {
    this.logsOpen.update((o) => !o);
  }

  /** Busca o histórico completo de logs do app no main */
  async loadLogs(id: string): Promise<void> {
    const lines = await this.processGateway.logs(id);
    this.logs.update((all) => ({ ...all, [id]: lines }));
  }

  async clearLogs(id: string): Promise<void> {
    await this.processGateway.clearLogs(id);
    this.logs.update((all) => ({ ...all, [id]: [] }));
  }

  private onProcessEvent(event: ProcessEvent): void {
    if (event.type === 'state') {
      this.mergeState(event.state);
      return;
    }
    if (event.type === 'update') {
      this.updateProgress.update((all) => ({ ...all, [event.id]: event.progress }));
      return;
    }
    this.logs.update((all) => {
      const next = [...(all[event.id] ?? []), ...event.lines];
      if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES);
      return { ...all, [event.id]: next };
    });
  }

  private mergeState(state: ProcessState): void {
    this.processes.update((map) => ({ ...map, [state.id]: state }));
  }
}

function isActive(status: RunStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'stopping';
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Erros do IPC chegam como "Error invoking remote method 'x': Error: msg"
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

function readBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}
