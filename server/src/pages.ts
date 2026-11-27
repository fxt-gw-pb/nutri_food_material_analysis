// 服务端直接输出的几个公开页面：首页、调研员登录页、链接无效页。不依赖前端构建，也不含任何脚本。
import { ServerConfig } from './config';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; background: #f6f7f2; color: #203c32;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 17px; line-height: 1.7; }
main { flex: 1; width: 100%; max-width: 480px; margin: 0 auto; padding: 56px 20px 32px; }
.eyebrow { color: #246b56; font-size: 14px; font-weight: 600; letter-spacing: 2px; }
h1 { margin: 8px 0 16px; font-size: 28px; line-height: 1.35; }
p { margin: 0 0 14px; color: #5d7065; }
.card { margin-top: 24px; padding: 22px; background: #fff; border: 1px solid #e5ebe1; border-radius: 16px; }
label { display: block; margin-bottom: 8px; font-weight: 600; }
input { display: block; width: 100%; height: 52px; padding: 0 14px; border: 2px solid #cbd8c8; border-radius: 12px; background: #f9fbf6;
  color: #203c32; font: inherit; font-size: 18px; }
input:focus { outline: 3px solid rgba(36,107,86,.3); border-color: #246b56; }
button, .button { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; margin-top: 16px; border: 0;
  border-radius: 12px; background: #246b56; color: #fff; font: inherit; font-size: 18px; font-weight: 600; text-decoration: none; cursor: pointer; }
.notice { margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #faf1df; color: #876229; font-size: 15px; }
.muted { color: #69796f; font-size: 14px; }
footer { padding: 20px; text-align: center; color: #69796f; font-size: 13px; }
footer a { color: inherit; }
`;

export function filingFooter(): string {
  const icp = process.env.ICP_NUMBER || '';
  const psb = process.env.PSB_NUMBER || '';
  const parts: string[] = [];
  if (icp) parts.push(`<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">${esc(icp)}</a>`);
  if (psb) parts.push(esc(psb));
  return parts.length ? `<footer>${parts.join(' · ')}</footer>` : '';
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main>${body}</main>${filingFooter()}</body></html>`;
}

export function landingPage(config: ServerConfig): string {
  return layout(config.siteTitle, `
<div class="eyebrow">${esc(config.siteTitle)}</div>
<h1>受邀参与者的饮食记录工具</h1>
<p>本站仅供已受邀的研究参与者及其调研员使用，不对外开放注册。</p>
<p>参与者请直接扫描调研员提供的专属二维码或链接进入；调研员请使用口令登录。</p>
<a class="button" href="/login">调研员登录</a>`);
}

export function loginPage(config: ServerConfig, query: URLSearchParams): string {
  const messages: Record<string, string> = {
    wrong: '口令不正确，请重试。',
    expired: '登录已失效，请重新登录。参与者请重新扫描专属二维码。',
    limited: '尝试次数过多，请 15 分钟后再试。',
    unset: '服务器尚未设置调研员口令，请联系管理员。',
  };
  const key = ['wrong', 'expired', 'limited', 'unset'].find((k) => query.has(k) || query.get('error') === k);
  return layout(`登录 · ${config.siteTitle}`, `
<div class="eyebrow">${esc(config.siteTitle)}</div>
<h1>调研员登录</h1>
<p>参与者无需登录，扫描调研员提供的专属二维码即可使用。</p>
${key ? `<div class="notice" role="alert">${esc(messages[key])}</div>` : ''}
<form class="card" method="post" action="/login" autocomplete="off">
  <label for="passcode">调研员口令</label>
  <input id="passcode" name="passcode" type="password" required maxlength="128" autocomplete="current-password" autofocus>
  <button type="submit">登录</button>
</form>
<p class="muted" style="margin-top:20px">登录后可为任意参与者编号拍照记录、饭后评估和查看汇总。</p>`);
}

export function invalidLinkPage(config: ServerConfig): string {
  return layout(`链接无效 · ${config.siteTitle}`, `
<div class="eyebrow">${esc(config.siteTitle)}</div>
<h1>这个链接已失效</h1>
<p>专属链接可能已被重新签发或停用。请联系调研员获取新的二维码。</p>`);
}

export function notFoundPage(config: ServerConfig): string {
  return layout(`页面不存在 · ${config.siteTitle}`, `<h1>页面不存在</h1><p><a href="/">返回首页</a></p>`);
}
