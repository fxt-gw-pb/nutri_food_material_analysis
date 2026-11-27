// 网页版入口。顺序很重要：先装全局 Page/wx，再加载页面模块，最后读登录身份并挂载。
import './runtime/globals';
import { createApp } from 'vue';
import { appStyles, pages } from 'virtual:wx-app';
import baseCss from './runtime/base.css?raw';
import webCss from './runtime/web.css?raw';
import { installRuntime, Root } from './runtime/app';
import { registerPageModule, startRouter } from './runtime/router';
import { fetchSession } from './api';
import { setSession } from './session';

function injectStyles(): void {
  const css = [baseCss, appStyles, ...pages.map((p) => p.css), webCss].join('\n');
  const style = document.createElement('style');
  style.setAttribute('data-wx', 'styles');
  style.textContent = css;
  document.head.appendChild(style);
}

async function boot(): Promise<void> {
  injectStyles();
  setSession(await fetchSession());
  pages.forEach((p) => registerPageModule({ route: p.route, render: p.render, templates: p.templates, config: p.config }));
  const app = createApp(Root);
  installRuntime(app);
  app.config.errorHandler = (err) => console.error('[web] 渲染出错', err);
  app.mount('#app');
  startRouter();
  document.getElementById('boot-status')?.remove();
}

boot().catch((err) => {
  // 未登录时 api.ts 已经跳去登录页，不算启动失败。
  if (err && (err as { status?: number }).status === 401) return;
  console.error('[web] 启动失败', err);
  const status = document.getElementById('boot-status');
  if (status) status.textContent = '页面加载失败，请检查网络后刷新重试。';
});
