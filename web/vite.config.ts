import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev the API runs separately; in production the API serves this app, so paths stay /api.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
