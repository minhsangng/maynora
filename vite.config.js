import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
});