import { describe, expect, it } from 'vitest';
import type { AppEntry } from './library';
import { MINHA_LIVRARIA } from './templates';
import { assetName, isNewer, MINHA_LIVRARIA_RELEASES, releaseSourceOf } from './updates';

describe('versões', () => {
  it('compara x.y.z como números', () => {
    expect(isNewer('1.1.0', '1.0.0')).toBe(true);
    expect(isNewer('v1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('2.0.0', '10.0.0')).toBe(false);
    expect(isNewer('1.1.0', '1.1.0')).toBe(false);
    expect(isNewer('1.0.0', '1.1.0')).toBe(false);
    expect(isNewer('1.1', '1.0.0')).toBe(false);
  });

  it('monta o nome do zip da release', () => {
    expect(assetName(MINHA_LIVRARIA_RELEASES, '1.1.0')).toBe(
      'minha-livraria-1.1.0-windows-x64.zip',
    );
  });
});

describe('releaseSourceOf', () => {
  const app: AppEntry = {
    ...MINHA_LIVRARIA.entry,
    id: 'livraria',
    folderId: '',
    workingDir: 'C:\\Apps\\MinhaLivraria',
  };

  it('reconhece a Minha Livraria cadastrada pelo modelo', () => {
    expect(releaseSourceOf(app)).toEqual(MINHA_LIVRARIA_RELEASES);
  });

  it('ignora outros apps e a Minha Livraria sem pasta', () => {
    expect(releaseSourceOf({ ...app, contract: undefined })).toBeUndefined();
    expect(releaseSourceOf({ ...app, workingDir: '' })).toBeUndefined();
    expect(releaseSourceOf({ ...app, kind: 'web-local' })).toBeUndefined();
  });
});
