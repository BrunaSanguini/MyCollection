import { describe, expect, it } from 'vitest';
import { DEFAULT_HUB_CONTRACT, sanitizeLibrary } from './library';

const app = (extra: Record<string, unknown>) => ({
  folders: [],
  apps: [{ id: 'livraria', name: 'Minha Livraria', command: 'MinhaLivraria.exe', ...extra }],
});

describe('sanitizeLibrary: contrato do hub', () => {
  it('mantém o contrato de um app com URL', () => {
    const contract = { ...DEFAULT_HUB_CONTRACT, tokenEnv: 'MINHA_LIVRARIA_SHUTDOWN_TOKEN' };
    const library = sanitizeLibrary(app({ url: 'http://127.0.0.1:8471/', contract }));
    expect(library.apps[0].contract).toEqual(contract);
  });

  it('descarta o contrato sem URL (não há onde perguntar a readiness)', () => {
    const library = sanitizeLibrary(app({ contract: DEFAULT_HUB_CONTRACT }));
    expect(library.apps[0].contract).toBeUndefined();
  });

  it('descarta variável de ambiente ou caminhos inválidos', () => {
    const url = 'http://127.0.0.1:8471/';
    for (const contract of [
      { ...DEFAULT_HUB_CONTRACT, tokenEnv: 'PATH; rm -rf' },
      { ...DEFAULT_HUB_CONTRACT, tokenEnv: '' },
      { ...DEFAULT_HUB_CONTRACT, readinessPath: 'actuator/health' },
      { ...DEFAULT_HUB_CONTRACT, shutdownPath: '/actuator/shutdown?x=1' },
      'sim',
    ]) {
      expect(sanitizeLibrary(app({ url, contract })).apps[0].contract).toBeUndefined();
    }
  });
});
