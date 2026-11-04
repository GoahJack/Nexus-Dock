import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          dock: resolve(__dirname, 'src/renderer/dock/index.html'),
          music: resolve(__dirname, 'src/renderer/music/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
          clock: resolve(__dirname, 'src/renderer/clock/index.html'),
          // v1.8 附加窗口：英语单词学习（注册表 kind=wordstudy / page=wordstudy）
          wordstudy: resolve(__dirname, 'src/renderer/wordstudy/index.html')
        }
      }
    }
  }
})
