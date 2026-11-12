import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

// One process in development: the API runs inside the Vite dev server.
const apiInDevServer = (): Plugin => ({
  name: 'balonche-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api')) {
        next();
        return;
      }
      const { createApp } = await server.ssrLoadModule('/server/app.ts');
      createApp()(req, res, next);
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), apiInDevServer()],
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node',
  },
});
