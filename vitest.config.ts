import { defineConfig } from 'vitest/config';

// Testes do processo principal (Electron) e dos tipos compartilhados. Rodam em Node puro.
export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
