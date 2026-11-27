// Vite 插件：把 miniprogram/ 目录直接当作网页版的页面源码。
//
//  - virtual:wx-app      按 app.json 的页面顺序，汇总每页的 渲染函数 / 样式 / 页面配置，并加载页面逻辑 .ts
//  - *.wxml              → wxml.mjs 转成 Vue 渲染函数
//  - *.wxss?wxss         → rpx 换算、100vh 扣掉导航栏、按页面加作用域（与小程序“页面样式只作用于本页”一致）
//  - 页面 .ts            → 模块开头写入 globalThis.__wxRoute，Page() 据此登记
//  - OVERRIDES           → 少数直接依赖微信云能力的模块换成网页实现
//  - /assets/*           → 图标与插画，开发时直接读 miniprogram/assets，构建时复制到产物
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { wxmlModule } from './wxml.mjs';

const VIRTUAL_ID = 'virtual:wx-app';
const RESOLVED_VIRTUAL_ID = '\0virtual:wx-app';

/** 网页与小程序说法不同的几处文案。找不到原文就报错，免得页面改了而这里悄悄失效。 */
export const WEB_TEXT = {
  'pages/questionnaire-history/questionnaire-history.wxml': [
    ['显示当前微信账号为此参与者提交的问卷。', '显示此参与者提交的全部问卷。'],
  ],
  'pages/daily/daily.wxml': [
    ['只统计本手机上为这位参与者拍的菜。', '统计这位参与者在网页上记录的全部菜品。'],
  ],
};

export function applyWebText(relative, source) {
  let out = source;
  for (const [from, to] of WEB_TEXT[relative] || []) {
    if (!out.includes(from)) throw new Error(`${relative}: 找不到需要替换的文案「${from}」，请同步 web/plugins/miniprogram.mjs 的 WEB_TEXT`);
    out = out.split(from).join(to);
  }
  return out;
}

// ---------------------------------------------------------------------------
// WXSS
// ---------------------------------------------------------------------------
function inlineImports(file, seen = new Set()) {
  if (seen.has(file)) return '';
  seen.add(file);
  const source = fs.readFileSync(file, 'utf8');
  return source.replace(/@import\s+["']([^"']+)["']\s*;?/g, (_, rel) => inlineImports(path.resolve(path.dirname(file), rel), seen));
}

export function convertUnits(value) {
  return value
    .replace(/(-?(?:\d+\.?\d*|\.\d+))rpx\b/g, (_, n) => `calc(var(--rpx) * ${n})`)
    // 小程序里 100vh 是导航栏以下的窗口高度；网页顶部多了一条导航栏，要扣掉。
    .replace(/(\d+(?:\.\d+)?)vh\b/g, (_, n) => `calc(${n}vh - var(--wx-nav-h) * ${Number(n) / 100})`);
}

export function scopeSelector(selector, scope) {
  const prefix = scope ? `:where(.wx-page[data-route="${scope}"])` : ':where(.wx-page)';
  let sel = selector.trim().replace(/(^|[\s>+~(,])image(?![\w-])/g, '$1img.wx-image');
  if (/^page(?![\w-])/.test(sel)) return sel.replace(/^page/, prefix);
  return scope ? `${prefix} ${sel}` : sel;
}

export function processWxss(file, scope) {
  const root = postcss.parse(inlineImports(file), { from: file });
  root.walkDecls((decl) => { decl.value = convertUnits(decl.value); });
  root.walkAtRules((rule) => { if (rule.params) rule.params = convertUnits(rule.params); });
  root.walkRules((rule) => {
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;
    rule.selectors = rule.selectors.map((s) => scopeSelector(s, scope));
  });
  return root.toString();
}

// ---------------------------------------------------------------------------
// 插件
// ---------------------------------------------------------------------------
export function miniprogramPlugin({ repoRoot }) {
  const mpRoot = path.join(repoRoot, 'miniprogram');
  const webSrc = path.join(repoRoot, 'web/src');
  const OVERRIDES = new Map([
    [path.join(mpRoot, 'services/config.ts'), path.join(webSrc, 'overrides/config.ts')],
    [path.join(mpRoot, 'services/mealService.cloud.ts'), path.join(webSrc, 'overrides/mealService.http.ts')],
    [path.join(mpRoot, 'services/userProfile.ts'), path.join(webSrc, 'overrides/userProfile.ts')],
  ]);
  const pageRoutes = () => JSON.parse(fs.readFileSync(path.join(mpRoot, 'app.json'), 'utf8')).pages;
  const routeOfPageTs = (id) => {
    const rel = path.relative(mpRoot, id.split('?')[0]).split(path.sep).join('/');
    const m = /^pages\/([^/]+)\/\1\.ts$/.exec(rel);
    return m ? rel.replace(/\.ts$/, '') : null;
  };
  let outDir = '';
  let base = '/';

  return {
    name: 'wx-miniprogram',
    enforce: 'pre',
    configResolved(config) { outDir = config.build.outDir; base = config.base; },

    async resolveId(source, importer, options) {
      if (source === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      // 覆盖模块内部用 @mp-original/... 取回被替换的原模块（不再走 OVERRIDES）。
      if (source.startsWith('@mp-original/')) return `${path.join(mpRoot, source.slice('@mp-original/'.length))}.ts`;
      if (source.endsWith('.wxss?wxss') || source.includes('.wxss?wxss&')) return source;
      if (!importer || source.startsWith('\0')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const override = OVERRIDES.get(resolved.id.split('?')[0]);
      if (override && importer.split('?')[0] !== override) return override;
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        const routes = pageRoutes();
        const lines = [`import appStylesCss from ${JSON.stringify(`${path.join(mpRoot, 'app.wxss')}?wxss`)};`];
        routes.forEach((route, i) => {
          const abs = path.join(mpRoot, route);
          lines.push(`import * as tpl${i} from ${JSON.stringify(`${abs}.wxml`)};`);
          lines.push(`import css${i} from ${JSON.stringify(`${abs}.wxss?wxss&scope=${route}`)};`);
          lines.push(`import config${i} from ${JSON.stringify(`${abs}.json`)};`);
          lines.push(`import ${JSON.stringify(`${abs}.ts`)};`);
        });
        lines.push('export const appStyles = appStylesCss;');
        lines.push(`export const pages = [${routes.map((route, i) =>
          `{ route: ${JSON.stringify(route)}, render: tpl${i}.render, templates: tpl${i}.templates, css: css${i}, config: config${i} }`).join(',\n')}];`);
        return lines.join('\n');
      }
      if (id.includes('.wxss?wxss')) {
        const [file, query] = id.split('?');
        const scope = new URLSearchParams(query).get('scope') || '';
        this.addWatchFile(file);
        return `export default ${JSON.stringify(processWxss(file, scope))};`;
      }
      if (id.endsWith('.wxml')) {
        const rel = path.relative(mpRoot, id).split(path.sep).join('/');
        const source = applyWebText(rel, fs.readFileSync(id, 'utf8'));
        return wxmlModule(source, rel, (src) => path.join(mpRoot, src.replace(/^\//, '')));
      }
      return null;
    },

    transform(code, id) {
      const route = routeOfPageTs(id);
      if (!route) return null;
      return { code: `globalThis.__wxRoute = ${JSON.stringify(route)};\n${code}`, map: null };
    },

    configureServer(server) {
      const prefix = `${base.replace(/\/$/, '')}/assets/`;
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(prefix)) return next();
        const rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]);
        const file = path.join(mpRoot, 'assets', rel);
        if (!file.startsWith(path.join(mpRoot, 'assets')) || !fs.existsSync(file)) return next();
        res.setHeader('Content-Type', file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },

    closeBundle() {
      if (!outDir) return;
      const target = path.resolve(outDir, 'assets');
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(path.join(mpRoot, 'assets'), target, { recursive: true });
    },
  };
}
