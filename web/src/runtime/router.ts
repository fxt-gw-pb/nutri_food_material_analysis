// 页面栈与浏览器历史。
//
// 与小程序一致：navigateTo 压栈、redirectTo 替换栈顶、navigateBack 出栈、reLaunch 清空后打开。
// 栈里的页面都保留在 DOM 中（只显示栈顶），返回时状态和滚动位置都还在。
// 浏览器的返回键、微信内置浏览器的返回按钮都会触发 popstate，这里把它翻译成 navigateBack。
import { shallowReactive } from 'vue';
import { callHook, createPageInstance, pageDefinition, PageInstance } from './page';

export interface PageConfig {
  navigationBarTitleText?: string;
  enablePullDownRefresh?: boolean;
}

export interface PageModule {
  route: string;
  render: (ctx: unknown, cache: unknown[]) => unknown;
  templates: Record<string, (ctx: unknown, cache: unknown[]) => unknown>;
  config: PageConfig;
}

export interface PageEntry {
  id: number;
  route: string;
  query: Record<string, string>;
  inst: PageInstance;
  module: PageModule;
  scrollY: number;
}

const modules = new Map<string, PageModule>();
export const HOME_ROUTE = 'pages/index/index';
export const stack = shallowReactive<PageEntry[]>([]);
let nextId = 1;

export function registerPageModule(mod: PageModule): void {
  modules.set(mod.route, mod);
}

interface ParsedUrl { route: string; query: Record<string, string>; search: string }

/** '/pages/x/x?a=1' → { route: 'pages/x/x', query: { a: '1' } }。与小程序相同，参数值不做解码。 */
export function parseUrl(url: string): ParsedUrl {
  const [pathPart, search = ''] = url.split('?');
  const route = pathPart.replace(/^\/+/, '');
  const query: Record<string, string> = {};
  search.split('&').filter(Boolean).forEach((pair) => {
    const idx = pair.indexOf('=');
    const key = idx >= 0 ? pair.slice(0, idx) : pair;
    query[key] = idx >= 0 ? pair.slice(idx + 1) : '';
  });
  return { route, query, search };
}

function hashFor(entry: { route: string; query: Record<string, string> }): string {
  const search = Object.keys(entry.query).map((k) => `${k}=${entry.query[k]}`).join('&');
  return `#/${entry.route}${search ? `?${search}` : ''}`;
}

function createEntry(url: string): PageEntry {
  const { route, query } = parseUrl(url);
  const mod = modules.get(route);
  if (!mod || !pageDefinition(route)) throw new Error(`页面不存在：${route}`);
  return { id: nextId++, route, query, inst: createPageInstance(route, query), module: mod, scrollY: 0 };
}

function top(): PageEntry | undefined { return stack[stack.length - 1]; }

function setTitle(entry?: PageEntry): void {
  document.title = entry?.module.config.navigationBarTitleText || '菜品质构识别';
}

function hide(entry?: PageEntry): void {
  if (!entry) return;
  entry.scrollY = window.scrollY;
  callHook(entry.inst, 'onHide');
}

function show(entry: PageEntry, restore: boolean): void {
  setTitle(entry);
  requestAnimationFrame(() => window.scrollTo(0, restore ? entry.scrollY : 0));
  callHook(entry.inst, 'onShow');
}

function unload(entry: PageEntry): void {
  callHook(entry.inst, 'onUnload');
}

function open(url: string): PageEntry {
  const entry = createEntry(url);
  stack.push(entry);
  callHook(entry.inst, 'onLoad', { ...entry.query });
  show(entry, false);
  return entry;
}

// ---------------------------------------------------------------------------
// 浏览器历史：history.state.wxDepth 记录这条历史对应的栈深度。
// ---------------------------------------------------------------------------
let silentPops = 0;
let silentResolve: (() => void) | null = null;

function goSilently(delta: number): Promise<void> {
  if (delta === 0) return Promise.resolve();
  return new Promise((resolve) => {
    silentPops += 1;
    silentResolve = resolve;
    history.go(delta);
    // 个别内置浏览器不触发 popstate，兜底继续。
    setTimeout(() => { if (silentResolve === resolve) { silentPops = Math.max(0, silentPops - 1); silentResolve = null; resolve(); } }, 400);
  });
}

function onPopState(event: PopStateEvent): void {
  if (silentPops > 0) {
    silentPops -= 1;
    const done = silentResolve;
    silentResolve = null;
    if (done) done();
    return;
  }
  const depth = (event.state && typeof event.state.wxDepth === 'number') ? event.state.wxDepth : 1;
  const url = location.hash.replace(/^#/, '') || `/${HOME_ROUTE}`;
  enqueue(async () => {
    const target = stack[depth - 1];
    const parsed = parseUrl(url);
    if (depth < stack.length && target && target.route === parsed.route) {
      // 用户按了返回：把多出来的页面出栈
      while (stack.length > depth) unload(stack.pop()!);
      show(top()!, true);
      return;
    }
    if (depth === stack.length + 1) {
      // 前进：重新打开那一页
      hide(top());
      safeOpen(url);
      return;
    }
    // 历史与页面栈对不上（比如刷新过），以地址栏为准重建。
    while (stack.length) unload(stack.pop()!);
    safeOpen(url);
    history.replaceState({ wxDepth: stack.length }, '', location.href);
  });
}

function safeOpen(url: string): PageEntry {
  try { return open(url); } catch (err) {
    console.error('[router] 打开页面失败', err);
    return open(`/${HOME_ROUTE}`);
  }
}

// 所有导航串行执行，避免「提示后 setTimeout 跳转」与用户点击交错。
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export function navigateTo(url: string): Promise<void> {
  return enqueue(() => {
    const prev = top();
    const entry = createEntry(url);
    hide(prev);
    stack.push(entry);
    history.pushState({ wxDepth: stack.length }, '', hashFor(entry));
    callHook(entry.inst, 'onLoad', { ...entry.query });
    show(entry, false);
  });
}

export function redirectTo(url: string): Promise<void> {
  return enqueue(() => {
    const entry = createEntry(url);
    const prev = stack.pop();
    if (prev) unload(prev);
    stack.push(entry);
    history.replaceState({ wxDepth: stack.length }, '', hashFor(entry));
    callHook(entry.inst, 'onLoad', { ...entry.query });
    show(entry, false);
  });
}

export function navigateBack(delta = 1): Promise<void> {
  return enqueue(async () => {
    const n = Math.max(1, Math.floor(delta || 1));
    if (stack.length <= 1) {
      // 网页可能是从深链直接打开的，栈底不是首页；返回时回到首页而不是什么都不做。
      if (top()?.route !== HOME_ROUTE) await relaunchNow(`/${HOME_ROUTE}`);
      return;
    }
    const count = Math.min(n, stack.length - 1);
    await goSilently(-count);
    for (let i = 0; i < count; i += 1) unload(stack.pop()!);
    show(top()!, true);
  });
}

async function relaunchNow(url: string): Promise<void> {
  const entry = createEntry(url);
  // 把浏览器历史退回到本应用的第一条，再替换成新页面：与小程序一样，reLaunch 后没有可返回的页面。
  if (stack.length > 1) await goSilently(-(stack.length - 1));
  while (stack.length) unload(stack.pop()!);
  stack.push(entry);
  history.replaceState({ wxDepth: 1 }, '', hashFor(entry));
  callHook(entry.inst, 'onLoad', { ...entry.query });
  show(entry, false);
}

export function reLaunch(url: string): Promise<void> {
  return enqueue(() => relaunchNow(url));
}

export function currentPages(): PageInstance[] {
  return stack.map((e) => e.inst);
}

export function topEntry(): PageEntry | undefined { return top(); }

export function startRouter(): void {
  window.addEventListener('popstate', onPopState);
  const url = location.hash.replace(/^#/, '') || `/${HOME_ROUTE}`;
  enqueue(() => {
    const entry = safeOpen(url);
    history.replaceState({ wxDepth: 1 }, '', hashFor(entry));
  });
}
