#!/usr/bin/env node
// 本地联调：同时启动后端（改动后自动重启）与前端开发服务器。
//   npm run web:dev                      真实识别（读取根目录 .env 里的 DASHSCOPE_API_KEY）
//   VISION_MOCK=1 npm run web:dev        不调用千问，3 秒后返回示例菜品
// 打开 http://localhost:5173/login（口令见 .env 的 RESEARCHER_PASSCODE，未设置时为 dev-passcode）。
// 手机连同一 Wi-Fi，访问终端里显示的 Network 地址即可联调。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const env = {
  ...process.env,
  RESEARCHER_PASSCODE: process.env.RESEARCHER_PASSCODE || 'dev-passcode',
  DATA_DIR: process.env.DATA_DIR || path.join(root, 'web-data'),
  WEB_DIST: path.join(root, 'web/dist'),
  PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || '',
  HOST: '127.0.0.1',
  PORT: '8787',
};

let child = null;
function restart() {
  if (child) child.kill('SIGTERM');
  child = spawn(process.execPath, ['--enable-source-maps', path.join(root, 'server/dist/server.cjs')], { env, stdio: 'inherit' });
}
const ctx = await context({
  entryPoints: { server: path.join(root, 'server/src/main.ts'), admin: path.join(root, 'server/src/admin.ts') },
  outdir: path.join(root, 'server/dist'), outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', format: 'cjs',
  target: 'node22', sourcemap: 'linked', logLevel: 'warning',
  plugins: [{ name: 'restart', setup(build) { build.onEnd((r) => { if (!r.errors.length) restart(); }); } }],
});
await ctx.watch();

const vite = await createServer({ configFile: path.join(root, 'web/vite.config.mjs') });
await vite.listen();
vite.printUrls();
console.log(`\n调研员口令：${env.RESEARCHER_PASSCODE}    登录：http://localhost:5173/login${process.env.VISION_MOCK === '1' ? '    （识别为模拟模式）' : ''}`);

const stop = async () => { if (child) child.kill('SIGTERM'); await ctx.dispose(); await vite.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
