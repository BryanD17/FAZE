import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev-only: lets the browser talk to the API on the same origin, which
      // keeps the refresh cookie behaving the way it will in production.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
});
