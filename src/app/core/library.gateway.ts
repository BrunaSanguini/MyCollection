import { Injectable } from '@angular/core';
import { DEFAULT_LIBRARY, sanitizeLibrary } from '../../../shared/library';
import { electronApi } from './electron-api';
import type { Library } from './models';

/**
 * Onde a biblioteca é lida/salva, visto pelo Angular.
 * - Dentro do Electron: IPC → arquivo library.json (JsonLibraryRepository)
 * - No navegador (`ng serve` puro): localStorage, só para desenvolvimento de UI
 */
@Injectable({ providedIn: 'root', useFactory: () => createGateway() })
export abstract class LibraryGateway {
  abstract readonly kind: 'electron' | 'browser';
  abstract load(): Promise<Library>;
  abstract save(library: Library): Promise<Library>;
}

class ElectronLibraryGateway extends LibraryGateway {
  readonly kind = 'electron' as const;
  private readonly api = electronApi()!;

  load(): Promise<Library> {
    return this.api.loadLibrary();
  }

  save(library: Library): Promise<Library> {
    return this.api.saveLibrary(library);
  }
}

const STORAGE_KEY = 'mc.library';

class BrowserLibraryGateway extends LibraryGateway {
  readonly kind = 'browser' as const;

  async load(): Promise<Library> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitizeLibrary(JSON.parse(raw));
    } catch {
      /* usa o padrão */
    }
    return structuredClone(DEFAULT_LIBRARY);
  }

  async save(library: Library): Promise<Library> {
    const clean = sanitizeLibrary(library);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      /* sem storage: fica só em memória */
    }
    return clean;
  }
}

function createGateway(): LibraryGateway {
  return electronApi() ? new ElectronLibraryGateway() : new BrowserLibraryGateway();
}
