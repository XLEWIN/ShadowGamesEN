import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    // Emit into the published webapp/ directory; keep existing assets there.
    outDir: '../webapp',
    emptyOutDir: false,
    assetsDir: '_app',
    rollupOptions: {
      input: {
        hub: resolve(root, 'index.html'),
        ludo: resolve(root, 'ludo/index.html'),
        chess: resolve(root, 'chess/index.html'),
      },
    },
  },
});
