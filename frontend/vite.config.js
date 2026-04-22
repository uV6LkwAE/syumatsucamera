import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  const isCmsBuild = mode === 'cms'

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, isCmsBuild ? 'index.cms.html' : 'index.html'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      hmr: {
        host: 'localhost',
      },
      proxy: {
        '/api': {
          target: process.env.VITE_BACKEND_ORIGIN ?? 'http://backend:8000',
          changeOrigin: true,
        },
        '/media': {
          target: process.env.VITE_BACKEND_ORIGIN ?? 'http://backend:8000',
          changeOrigin: true,
        },
        '/sitemap.xml': {
          target: process.env.VITE_BACKEND_ORIGIN ?? 'http://backend:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
