import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Ponte segura entre o Angular (renderer) e o processo principal.
 * Tudo que o front pode pedir ao sistema passa por aqui — nada de Node no renderer.
 * O contrato tipado fica em src/app/core/electron-api.ts.
 *
 * Observação: com sandbox ativo o preload só pode usar `require('electron')`,
 * por isso aqui não importamos nada de ../shared.
 */
contextBridge.exposeInMainWorld('myCollection', {
  getInfo: () => ipcRenderer.invoke('app:info'),
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  saveLibrary: (library: unknown) => ipcRenderer.invoke('library:save', library),
  revealDataFile: () => ipcRenderer.invoke('library:reveal'),
  pickFolder: (defaultPath?: string) => ipcRenderer.invoke('dialog:pick-folder', defaultPath),
  exportLibrary: () => ipcRenderer.invoke('library:export'),
  importLibrary: () => ipcRenderer.invoke('library:import'),

  // Configurações e ícones
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:set', settings),
  pickIcon: () => ipcRenderer.invoke('icons:pick'),

  // Execução dos apps (o main busca o comando pelo id; o renderer nunca envia comandos)
  startApp: (id: string) => ipcRenderer.invoke('process:start', id),
  stopApp: (id: string) => ipcRenderer.invoke('process:stop', id),
  openApp: (id: string) => ipcRenderer.invoke('process:open', id),
  listProcesses: () => ipcRenderer.invoke('process:list'),
  getLogs: (id: string) => ipcRenderer.invoke('process:logs', id),
  clearLogs: (id: string) => ipcRenderer.invoke('process:clear-logs', id),
  onProcessEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('process:event', listener);
    return () => ipcRenderer.removeListener('process:event', listener);
  },
});
