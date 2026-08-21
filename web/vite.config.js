import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // 开发期把 API 转发到本地服务；原型预览不走代理，
      // 必须直连预览端口才能保持「不同源」这个安全前提
      '/api': { target: 'http://127.0.0.1:7788', changeOrigin: true }
    }
  },
  build: {
    // 产物直接落到 web/dist，protohub serve 从这里读
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600
  }
})
