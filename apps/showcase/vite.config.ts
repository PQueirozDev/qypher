import { defineConfig } from 'vite';

export default defineConfig({
  root: 'apps/showcase',
  // Cache próprio: o app desktop roda outro servidor Vite em paralelo nos testes.
  cacheDir: '../../node_modules/.vite-showcase',
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1421, strictPort: true },
  preview: { host: '127.0.0.1', port: 1421, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
