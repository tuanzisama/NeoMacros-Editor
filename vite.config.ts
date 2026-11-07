import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // monaco-editor 自带纯 ESM；排除预打包，避免主入口与 editor.main
  // 拆成两个模块实例（editor 功能贡献注册表分裂，Ctrl+Click 转到定义失效）
  optimizeDeps: {
    exclude: ['monaco-editor'],
  },
  build: {
    chunkSizeWarningLimit: 6000,
  },
  server: {
    port: 3121
  }
})
