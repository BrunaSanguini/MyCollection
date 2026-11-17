import { BrowserWindow, shell } from 'electron';
import type { AppEntry } from '../../shared/library';

/**
 * Janelas próprias dos apps (openMode = 'own-window').
 * Cada app tem no máximo uma janela; abrir de novo só traz para frente.
 * As janelas NÃO têm preload: o app carregado não acessa nada do My Collection.
 */
export class AppWindows {
  private readonly windows = new Map<string, BrowserWindow>();

  open(app: AppEntry, url: string): void {
    if (app.openMode === 'browser') {
      void shell.openExternal(url);
      return;
    }

    const existing = this.windows.get(app.id);
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
      return;
    }

    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      title: app.name,
      backgroundColor: '#0e141d',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Links externos do app abrem no navegador padrão
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (target.startsWith('http://') || target.startsWith('https://')) void shell.openExternal(target);
      return { action: 'deny' };
    });

    win.on('closed', () => this.windows.delete(app.id));
    this.windows.set(app.id, win);
    void win.loadURL(url);
  }

  close(appId: string): void {
    const win = this.windows.get(appId);
    if (win && !win.isDestroyed()) win.close();
    this.windows.delete(appId);
  }

  closeAll(): void {
    for (const id of [...this.windows.keys()]) this.close(id);
  }
}
