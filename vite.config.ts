import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'core'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
