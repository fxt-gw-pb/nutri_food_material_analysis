// 管理命令（在服务器上运行，读取与服务相同的环境变量）：
//
//   node server/dist/admin.cjs issue 001207 [--note 张阿姨]   为参与者签发专属链接（重新签发会让旧链接失效）
//   node server/dist/admin.cjs sheet 001207 001208 …          批量签发，并生成可打印的二维码页
//   node server/dist/admin.cjs revoke 001207                  停用某位参与者的链接
//   node server/dist/admin.cjs list                           列出参与者与链接状态
//   node server/dist/admin.cjs export [--out 目录] [--merge 小程序导出的meal_records.json]
//                                                            导出 meal_records.json / questionnaire_responses.json
//   node server/dist/admin.cjs backup [--out 目录] [--keep 14]  备份数据库并同步照片
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { Auth } from './auth';
import { loadConfig } from './config';
import { Doc, Store } from './db';

const HELP = `管理命令（与服务读取相同的环境变量，需在数据目录所在的机器上运行）：
  issue <编号> [--note 备注]        签发专属链接并在终端显示二维码（重新签发会让旧链接失效）
  sheet <编号1> <编号2> …           批量签发，生成可打印的二维码页（数据目录/links/）
  revoke <编号>                     停用某位参与者的链接，已登录设备随即退出
  list                              列出参与者、链接状态、已登录设备数和识别条数
  export [--out 目录] [--merge 小程序导出的 meal_records.json]
                                    导出 meal_records.json 与 questionnaire_responses.json
  backup [--out 目录] [--keep 14]   备份数据库（VACUUM INTO）并增量复制照片`;

const config = loadConfig();
const args = process.argv.slice(2);
const command = args[0];

function option(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function positional(): string[] {
  const out: string[] = [];
  for (let i = 1; i < args.length; i += 1) {
    if (args[i].startsWith('--')) { i += 1; continue; }
    out.push(args[i]);
  }
  return out;
}
const stamp = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function requireOrigin(): void {
  if (!config.publicOrigin) {
    console.error('请先设置 PUBLIC_ORIGIN（如 https://你的域名），链接里要用到它。本地测试可设 PUBLIC_ORIGIN=http://电脑局域网IP:5173');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }
  const store = new Store(config.dataDir);
  const auth = new Auth(store, config);
  try {
    if (command === 'issue') {
      requireOrigin();
      const [code] = positional();
      if (!code) throw new Error('用法：issue <参与者编号> [--note 备注]');
      const link = auth.participantLink(auth.issueParticipantToken(code, option('--note') || ''));
      console.log(`参与者 ${code.trim()} 的专属链接（旧链接已失效）：\n${link}\n`);
      console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
      return;
    }
    if (command === 'sheet') {
      requireOrigin();
      const codes = positional();
      if (!codes.length) throw new Error('用法：sheet <编号1> <编号2> …');
      const cards: string[] = [];
      const csv = ['participantCode,link'];
      for (const code of codes) {
        const link = auth.participantLink(auth.issueParticipantToken(code));
        const svg = await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        cards.push(`<section><div class="qr">${svg}</div><div class="code">编号 ${esc(code.trim())}</div><p>用手机微信「扫一扫」或相机扫码打开。打开后会自动记住身份，之后可从微信「收藏」或浏览器书签再次进入。</p><div class="link">${esc(link)}</div></section>`);
        csv.push(`"${code.trim()}",${link}`);
      }
      const dir = path.join(config.dataDir, 'links');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const base = path.join(dir, `links-${stamp()}`);
      fs.writeFileSync(`${base}.html`, `<!doctype html><meta charset="utf-8"><title>参与者二维码</title><style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:24px;color:#203c32}
section{display:inline-block;width:300px;margin:0 16px 24px 0;padding:18px;border:1px solid #cbd8c8;border-radius:12px;vertical-align:top;break-inside:avoid}
.qr svg{width:100%;height:auto}.code{font-size:22px;font-weight:700;margin:8px 0}p{font-size:14px;line-height:1.6;margin:0 0 8px}.link{font-size:10px;color:#69796f;word-break:break-all}
</style>${cards.join('\n')}`, { mode: 0o600 });
      fs.writeFileSync(`${base}.csv`, `${csv.join('\n')}\n`, { mode: 0o600 });
      console.log(`已为 ${codes.length} 位参与者签发新链接（各自的旧链接已失效）：\n  打印页 ${base}.html\n  清单   ${base}.csv\n二维码等同于登录凭据，请妥善保管，用完删除。`);
      return;
    }
    if (command === 'revoke') {
      const [code] = positional();
      if (!code) throw new Error('用法：revoke <参与者编号>');
      console.log(auth.revokeParticipant(code) ? `已停用 ${code.trim()} 的链接，已登录的设备也会退出。` : `没有找到参与者 ${code.trim()}`);
      return;
    }
    if (command === 'list') {
      const rows = store.db.prepare(`SELECT p.code, p.note, p.tokenIssuedAt, p.revokedAt,
          (SELECT COUNT(*) FROM sessions s WHERE s.role = 'participant' AND s.participantCode = p.code AND s.expiresAt > ?) AS devices,
          (SELECT COUNT(*) FROM meal_records m WHERE m.participantCode = p.code) AS meals
        FROM participants p ORDER BY p.code`).all(Date.now()) as { code: string; note: string; tokenIssuedAt: number; revokedAt: number | null; devices: number; meals: number }[];
      if (!rows.length) { console.log('还没有签发过参与者链接。'); return; }
      const fmt = (t: number | null) => (t ? new Date(t + 8 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : '');
      console.log('编号\t状态\t签发时间(北京)\t已登录设备\t识别记录\t备注');
      rows.forEach((r) => console.log(`${r.code}\t${r.revokedAt ? '已停用' : '有效'}\t${fmt(r.tokenIssuedAt)}\t${r.devices}\t${r.meals}\t${r.note}`));
      return;
    }
    if (command === 'export') {
      const out = path.resolve(option('--out') || path.join('exports', `web-${stamp()}`));
      fs.mkdirSync(out, { recursive: true });
      let meals: Doc[] = store.allMeals();
      const mergeFile = option('--merge');
      if (mergeFile) {
        const source = fs.readFileSync(mergeFile, 'utf8').replace(/^﻿/, '').trim();
        let cloud: Doc[];
        try { cloud = JSON.parse(source); } catch { cloud = source.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); }
        if (!Array.isArray(cloud)) cloud = (cloud as { data?: Doc[] }).data || [];
        const ids = new Set(cloud.map((d) => d._id));
        const dup = meals.find((d) => ids.has(d._id));
        if (dup) throw new Error(`记录 ${dup._id} 同时出现在两份数据里，请确认没有重复合并`);
        meals = [...cloud, ...meals];
        console.log(`已合并小程序导出 ${cloud.length} 条 + 网页版 ${meals.length - cloud.length} 条`);
      }
      fs.writeFileSync(path.join(out, 'meal_records.json'), `${JSON.stringify(meals, null, 1)}\n`);
      fs.writeFileSync(path.join(out, 'questionnaire_responses.json'), `${JSON.stringify(store.allQuestionnaires(), null, 1)}\n`);
      console.log(`导出完成：${out}\n  meal_records.json（${meals.length} 条）\n  questionnaire_responses.json\n转 CSV：npm run export:data -- --input "${path.join(out, 'meal_records.json')}"`);
      return;
    }
    if (command === 'backup') {
      const out = path.resolve(option('--out') || path.join(config.dataDir, '..', 'food-web-backups'));
      const keep = Math.max(1, Number(option('--keep')) || 14);
      fs.mkdirSync(path.join(out, 'db'), { recursive: true, mode: 0o700 });
      const target = path.join(out, 'db', `app-${stamp()}.db`);
      store.db.prepare('VACUUM INTO ?').run(target);
      // 照片只增不改，复制新增的即可。
      let copied = 0;
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          const dest = path.join(out, 'images', path.relative(store.imageDir, abs));
          if (entry.isDirectory()) { fs.mkdirSync(dest, { recursive: true }); walk(abs); } else if (!fs.existsSync(dest)) { fs.copyFileSync(abs, dest); copied += 1; }
        }
      };
      fs.mkdirSync(path.join(out, 'images'), { recursive: true });
      walk(store.imageDir);
      const dbs = fs.readdirSync(path.join(out, 'db')).filter((f) => /^app-.*\.db$/.test(f)).sort();
      dbs.slice(0, Math.max(0, dbs.length - keep)).forEach((f) => fs.rmSync(path.join(out, 'db', f)));
      console.log(`备份完成：${target}；新增照片 ${copied} 张；保留最近 ${keep} 份数据库备份。`);
      return;
    }
    throw new Error(`未知命令 ${command}，运行 help 查看用法`);
  } finally {
    store.close();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
