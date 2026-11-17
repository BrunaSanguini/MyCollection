import { DEFAULT_LIBRARY, Library, sanitizeLibrary } from '../../shared/library';
import { JsonFile } from './json-file';

/**
 * Contrato de persistência da biblioteca.
 * Hoje: JSON. Se um dia precisar de histórico/logs, basta outra implementação (ex.: SQLite).
 */
export interface LibraryRepository {
  load(): Promise<Library>;
  save(library: Library): Promise<Library>;
  readonly location: string;
}

/** Biblioteca inteira em um único arquivo JSON (escrita atômica — ver JsonFile). */
export class JsonLibraryRepository implements LibraryRepository {
  private readonly file: JsonFile<Library>;

  constructor(filePath: string) {
    this.file = new JsonFile(filePath, sanitizeLibrary, () => structuredClone(DEFAULT_LIBRARY));
  }

  get location(): string {
    return this.file.filePath;
  }

  load(): Promise<Library> {
    return this.file.read();
  }

  save(library: Library): Promise<Library> {
    return this.file.write(library);
  }
}
