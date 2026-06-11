import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionStamp } from 'digital-boardgame-framework/vite';

export default defineConfig({
  plugins: [react(), versionStamp()],
  resolve: { dedupe: ['react', 'react-dom'] }, // framework-fit-notes 2026-06-02
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: !!process.env.PORT,
    // local UI dev against the deployed Functions
    proxy: { '/api': 'https://axis-and-allies-classic.pages.dev' },
  },
});
