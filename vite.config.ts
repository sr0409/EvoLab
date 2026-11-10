import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: false,
    host: '127.0.0.1'
  },
  build: {
    target: 'es2022',
    sourcemap: true
  }
})
