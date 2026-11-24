#!/usr/bin/env node
// 管理员在电脑运行：云端整集合导出 → 下载原始 JSON → 同一套本地转换。
// 不修改 meal_records，不部署云函数，不把管理凭据放进小程序。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ROOT, parseRecords, exportFile, createRunDirectory } = require('./export/core.cjs');
const { parseArgs, report } = require('./export-meals.cjs');

function configuredEnv() {
  const config = fs.readFileSync(path.join(ROOT, 'miniprogram/services/config.ts'), 'utf8');
  const env = config.match(/\bcloudEnv\s*:\s*['"]([^'"]+)['"]/);
  if (!env) throw Error('未找到云环境ID，请用 --env-id 指定');
  return env[1];
}
function runTcb(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('tcb', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (value) => { stdout += value; });
    child.stderr.setEncoding('utf8').on('data', (value) => { stderr = (stderr + value).slice(-10000); });
    child.on('error', (error) => reject(error.code === 'ENOENT'
      ? Error('未安装 CloudBase CLI。先运行 npm install -g @cloudbase/cli@3.8.4，然后 tcb login；也可用后台JSON离线导出。') : error));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else {
        let reason = '';
        try { const result = JSON.parse(stdout); reason = result.error?.code || ''; } catch { /* 不打印可能含临时下载链接的原始输出 */ }
        if (/AUTH|LOGIN|PERMISSION/i.test(reason + stderr) || code === 2) reason = '登录已失效或账号无环境权限，请执行 tcb login';
        reject(Error(`云端导出未成功（退出码 ${code}${reason ? `，${reason}` : ''}）。请检查CLI版本、网络及环境权限；本次不会生成CSV。`));
      }
    });
  });
}
function parseDownloadResult(stdout, rawDirectory) {
  let result;
  try { result = JSON.parse(stdout).data; } catch { throw Error('无法解析CLI导出响应，请使用文档指定的CLI版本'); }
  if (!result || String(result.status).toLowerCase() !== 'success') throw Error('云端未确认导出成功，不生成CSV');
  const success = Number(result.recordSuccess);
  const fail = Number(result.recordFail);
  const countValue = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) || (typeof v === 'string' && /^\d+$/.test(v));
  if (!countValue(result.recordSuccess) || !countValue(result.recordFail) || !Number.isSafeInteger(success) || fail !== 0) {
    throw Error('云端导出包含失败记录或缺少记录计数，不生成可能不完整的CSV');
  }
  if (typeof result.path !== 'string') throw Error('CLI未返回下载文件路径');
  const filename = path.resolve(result.path);
  const relative = path.relative(fs.realpathSync(rawDirectory), fs.realpathSync(filename));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('下载文件不在本次原始数据目录中');
  // 云端确认0条时，兼容导出服务产生的空文件；离线转换仍拒绝未知的空文件。
  const content = fs.readFileSync(filename, 'utf8');
  if (success === 0 && !content.trim()) fs.writeFileSync(filename, '[]\n');
  const count = parseRecords(fs.readFileSync(filename, 'utf8')).length;
  if (count !== success) throw Error(`下载文件为 ${count} 条，云端报告 ${success} 条；请重新导出`);
  return { filename, metadata: { jobId: result.jobId, status: result.status, recordSuccess: success, recordFail: fail, requestId: result.requestId } };
}
async function downloadAndExport(options, runner = runTcb) {
  const { envId = configuredEnv(), ...filters } = options;
  if (!/^[a-zA-Z0-9_-]+$/.test(envId)) throw Error('云环境ID格式无效');
  const output = createRunDirectory(path.resolve(filters.out || path.join(ROOT, 'exports/runs')));
  const rawDirectory = path.join(output, 'raw');
  fs.mkdirSync(rawDirectory);
  const stdout = await runner(['db', 'nosql', 'dump', 'meal_records', '--file-type', 'json', '--output-dir', rawDirectory, '--env-id', envId, '--json']);
  const { filename, metadata } = parseDownloadResult(stdout, rawDirectory);
  fs.writeFileSync(path.join(output, 'cloud-export.json'), JSON.stringify({ envId, collection: 'meal_records', ...metadata }, null, 2) + '\n', { flag: 'wx' });
  return exportFile(filename, filters, output);
}
async function main() {
  const { help, ...options } = parseArgs(process.argv.slice(2), true);
  if (help) {
    console.log(`云端直接导出（电脑上的管理员账号）

首次准备：
  npm install -g @cloudbase/cli@3.8.4
  tcb login

日常导出：
  npm run export:cloud
  npm run export:cloud -- --from 2026-09-01 --to 2026-09-30 --completed-only

默认读取 miniprogram/services/config.ts 的 cloudEnv。
可用 --env-id 指定其他环境；其余筛选/输出选项与 export:data 相同。
下载完整 meal_records 后在本地筛选，原始文件保存在当次输出目录的 raw/。
需要云环境管理员权限，不使用参与者在小程序内的读取权限。
CLI会在云存储中产生导出文件；不更改原集合记录。
详见 docs/data-export.md。`);
    return;
  }
  console.log('正在导出并下载 meal_records；完成后会核对云端记录数，再生成CSV。');
  const timer = setInterval(() => console.log('仍在等待云端导出/下载完成…'), 30000);
  try { report(await downloadAndExport(options)); } finally { clearInterval(timer); }
}
if (require.main === module) main().catch((error) => { console.error(`导出失败：${error.message}`); process.exitCode = 1; });
module.exports = { configuredEnv, parseDownloadResult, downloadAndExport };
