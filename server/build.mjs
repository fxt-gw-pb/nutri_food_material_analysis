// 把后端打成两个自包含文件（server/dist/server.cjs、admin.cjs）：服务器上只需要 Node 24，不用 npm install。
// 产物内含《中国食物成分表》数据（摄入计算要用），与 web/dist 一样不得提交到公开仓库。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const options = {
  entryPoints: { server: path.join(here, 'src/main.ts'), admin: path.join(here, 'src/admin.ts') },
  outdir: path.join(here, 'dist'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'info',
};
if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
