import { defineConfig } from 'vite';

// 将旧版 boardgame.io 的目录入口统一打包，避免 Node ESM 直接加载失败。
export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: 'server/standalone.ts',
    outDir: 'server-dist',
    target: 'node20',
    rollupOptions: { output: { entryFileNames: 'standalone.mjs' } },
  },
});
