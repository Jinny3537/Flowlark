import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@umijs/max': fileURLToPath(new URL('./src/umi-shim.ts', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期把 API 转发到本地服务；原型预览不走代理，
      // 必须直连预览端口才能保持「不同源」这个安全前提
      '/api': { target: 'http://127.0.0.1:7788', changeOrigin: true }
    }
  },
  build: {
    // 产物直接落到 web/dist，flowlark serve 从这里读
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600
  }
})
