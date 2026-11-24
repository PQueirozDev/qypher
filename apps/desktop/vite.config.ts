import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  .version as string;

export default defineConfig({
  root: 'apps/desktop',
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Pré-empacota as dependências na inicialização: sem isso, um cache vazio (CI)
  // pode descobrir dependências tarde e invalidar módulos já carregados (504
  // "Outdated Optimize Dep"), quebrando a página no meio dos testes.
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'lucide-react',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    warmup: { clientFiles: ['./src/main.tsx'] },
  },
  preview: { host: '127.0.0.1', port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
