import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitizeLibrary } from '../shared/library';
import { DEFAULT_SETTINGS, Settings, sanitizeSettings } from '../shared/settings';
import { AppWindows } from './launcher/app-windows';
import { ProcessManager } from './launcher/process-manager';
import { ICON_EXTENSIONS, IconStore } from './storage/icon-store';
import { JsonFile } from './storage/json-file';
import { JsonLibraryRepository, LibraryRepository } from './storage/library-repository';

/**
 * Processo principal do My Collection.
 * - Em desenvolvimento (`--serve`) carrega o `ng serve` em http://localhost:4200
 * - Em produção carrega o build do Angular em dist/my-collection/browser
 */
const isServe = process.argv.includes('--serve');
const DEV_URL = 'http://localhost:4200';

// Pasta de dados: %APPDATA%\My Collection (Windows)
app.setName('My Collection');
if (process.platform === 'win32') app.setAppUserModelId('dev.bru.mycollection');

// Só uma instância do hub: abrir de novo traz a janela existente para frente
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

// mc-icon://icons/<arquivo> → imagens dos apps em userData/icons
protocol.registerSchemesAsPrivileged([
  { scheme: 'mc-icon', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let repository: LibraryRepository;
let icons: IconStore;
let settingsFile: JsonFile<Settings>;
let settings: Settings = DEFAULT_SETTINGS;
/** true depois que o usuário confirmou o fechamento (ou não havia o que confirmar) */
let closeConfirmed = false;

const appWindows = new AppWindows();
const processes = new ProcessManager({
  emit: (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('process:event', event);
  },
  open: (entry, url) => appWindows.open(entry, url),
  closeWindows: (id) => appWindows.close(id),
});

/** Busca o app no arquivo salvo — o renderer só manda o id, nunca o comando */
async function findApp(id: unknown) {
  if (typeof id !== 'string') throw new Error('id inválido');
  const library = await repository.load();
  const entry = library.apps.find((a) => a.id === id);
  if (!entry) throw new Error('App não encontrado');
  return entry;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'My Collection',
    backgroundColor: '#0e141d',
    autoHideMenuBar: true,
    show: false,
    // No app instalado o ícone vem do .exe; em dev usamos o PNG
    ...(app.isPackaged ? {} : { icon: path.join(__dirname, '..', '..', 'build', 'icon.png') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Links externos (target=_blank / window.open) abrem no navegador padrão
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Confirma antes de fechar se houver apps rodando
  mainWindow.on('close', (event) => {
    const active = processes.activeCount();
    if (closeConfirmed || !settings.confirmOnQuit || active === 0) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'question',
      buttons: ['Fechar e parar os apps', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'My Collection',
      message: active === 1 ? 'Há 1 app em execução.' : `Há ${active} apps em execução.`,
      detail: 'Ao fechar, os apps iniciados pelo My Collection serão encerrados. Containers em segundo plano continuam rodando.',
    });
    if (choice === 0) {
      closeConfirmed = true;
      mainWindow?.close();
    }
  });

  if (isServe) {
    void mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // __dirname = dist-electron/electron
    void mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'my-collection', 'browser', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Fechar o hub fecha também as janelas dos apps
    appWindows.closeAll();
  });
}

function applySettings(next: Settings): void {
  settings = next;
  processes.setReadyTimeout(next.readyTimeoutSec * 1000);
  // Só faz sentido no app instalado (em dev registraria o electron.exe)
  if (app.isPackaged && process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
  }
}

function registerIpc(): void {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    packaged: app.isPackaged,
    dataFile: repository.location,
  }));

  // ---- Biblioteca (apps + pastas)
  ipcMain.handle('library:load', () => repository.load());
  ipcMain.handle('library:save', (_event, library: unknown) => repository.save(library as never));
  ipcMain.handle('library:reveal', () => shell.showItemInFolder(repository.location));

  ipcMain.handle('library:export', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Exportar biblioteca',
      defaultPath: path.join(app.getPath('documents'), `my-collection-backup-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const library = await repository.load();
    await fs.writeFile(result.filePath, JSON.stringify(library, null, 2) + '\n', 'utf-8');
    return result.filePath;
  });

  ipcMain.handle('library:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Importar biblioteca',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const raw = await fs.readFile(result.filePaths[0], 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('O arquivo escolhido não é um JSON válido.');
    }
    const library = sanitizeLibrary(parsed);
    // Para os apps em execução antes de trocar a biblioteca
    await Promise.all(processes.list().map((p) => processes.stop(p.id)));
    return repository.save(library);
  });

  // ---- Configurações
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', async (_e, value: unknown) => {
    const saved = await settingsFile.write(sanitizeSettings(value));
    applySettings(saved);
    return saved;
  });

  // ---- Ícones
  ipcMain.handle('icons:pick', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Escolher ícone do app',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ICON_EXTENSIONS }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return icons.import(result.filePaths[0]);
  });

  // ---- Execução dos apps
  ipcMain.handle('process:start', async (_e, id: unknown) => processes.start(await findApp(id)));
  ipcMain.handle('process:stop', (_e, id: unknown) => processes.stop(String(id)));
  ipcMain.handle('process:list', () => processes.list());
  ipcMain.handle('process:logs', (_e, id: unknown) => processes.getLogs(String(id)));
  ipcMain.handle('process:clear-logs', (_e, id: unknown) => processes.clearLogs(String(id)));
  ipcMain.handle('process:open', async (_e, id: unknown) => {
    const entry = await findApp(id);
    const state = processes.list().find((p) => p.id === entry.id);
    const url = state?.url ?? entry.url;
    if (url) appWindows.open(entry.openMode === 'none' ? { ...entry, openMode: 'own-window' } : entry, url);
  });

  // ---- Seletor de pasta (campo "Diretório do projeto")
  ipcMain.handle('dialog:pick-folder', async (_event, defaultPath: unknown) => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Selecione a pasta do projeto',
      properties: ['openDirectory'],
      ...(typeof defaultPath === 'string' && defaultPath ? { defaultPath } : {}),
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}

function registerIconProtocol(): void {
  protocol.handle('mc-icon', (request) => {
    const { host, pathname } = new URL(request.url);
    const file = host === 'icons' ? icons.resolve(decodeURIComponent(pathname.slice(1))) : null;
    if (!file) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  repository = new JsonLibraryRepository(path.join(userData, 'library.json'));
  icons = new IconStore(path.join(userData, 'icons'));
  settingsFile = new JsonFile(path.join(userData, 'settings.json'), sanitizeSettings, () => ({ ...DEFAULT_SETTINGS }));

  applySettings(await settingsFile.read().catch(() => DEFAULT_SETTINGS));

  // Limpa imagens de ícones que nenhum app usa mais
  const library = await repository.load().catch(() => null);
  if (library) void icons.collectGarbage(library.apps.flatMap((a) => (a.icon ? [a.icon] : [])));

  registerIconProtocol();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Ao sair, encerra os processos iniciados pelo hub (apps em segundo plano, como Docker -d, continuam)
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  appWindows.closeAll();
  void processes.shutdown().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
