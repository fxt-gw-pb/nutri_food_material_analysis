// 网页版前端构建配置。开发：npm run web:dev（见 scripts/web/dev.mjs）；构建：npm run web:build。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { miniprogramPlugin } from './plugins/miniprogram.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const backend = process.env.WEB_BACKEND || 'http://127.0.0.1:8787';

export default defineConfig({
  root: here,
  base: '/app/',
  publicDir: false,
  plugins: [miniprogramPlugin({ repoRoot })],
  resolve: { extensions: ['.ts', '.mjs', '.js', '.json'] },
  build: {
    outDir: path.join(here, 'dist'),
    emptyOutDir: true,
    assetsDir: '_app',
    target: ['es2020', 'safari14', 'chrome87'],
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: Object.fromEntries(['/api', '/login', '/p/', '/logout'].map((p) => [p, { target: backend, changeOrigin: false }])),
  },
  define: { __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
});
