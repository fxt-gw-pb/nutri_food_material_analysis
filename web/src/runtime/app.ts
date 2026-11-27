// 网页外壳：顶部导航栏 + 页面栈 + 提示层，以及 WXML 需要的两个指令（hover-class、长按）和 <template is>。
import { App, defineComponent, h, inject, PropType, provide, computed, Directive } from 'vue';
import { callHook } from './page';
import { HOME_ROUTE, navigateBack, PageEntry, reLaunch, stack } from './router';
import { Overlays, ui } from './ui';
import { onPullRefreshStop } from './wx';
import { session } from '../session';
import { logout } from '../api';

type RenderFn = (ctx: unknown, cache: unknown[]) => unknown;

const BASE = import.meta.env.BASE_URL || '/';
export function assetUrl(path: string): string {
  return path.startsWith('/') ? `${BASE}${path.slice(1)}` : path;
}

interface DomTarget extends EventTarget { id?: string; value?: string; type?: string; __wxSuppressTap?: boolean; blur?: () => void }

function dispatch(entry: PageEntry, name: string, domEvent: Event, dataset: Record<string, unknown>, kind: string): void {
  const el = domEvent.currentTarget as DomTarget | null;
  if (kind === 'tap' && el && el.__wxSuppressTap) { el.__wxSuppressTap = false; return; }
  const handler = entry.inst[name];
  if (typeof handler !== 'function') {
    console.warn(`[${entry.route}] 没有事件处理函数 ${name}`);
    return;
  }
  let detail: Record<string, unknown> = {};
  if (kind === 'input' || kind === 'confirm' || kind === 'blur' || kind === 'focus') detail = { value: el?.value ?? '' };
  if (kind === 'change') detail = { value: el?.type === 'range' ? Number(el.value) : el?.value ?? '' };
  if (kind === 'tap' || kind === 'longpress') {
    const p = domEvent as PointerEvent;
    detail = { x: p.clientX ?? 0, y: p.clientY ?? 0 };
  }
  if (kind === 'confirm' && el?.blur) el.blur();
  const target = domEvent.target as DomTarget | null;
  callHook(entry.inst, name, {
    type: kind, timeStamp: Date.now(), detail, mark: {},
    currentTarget: { id: el?.id || '', dataset }, target: { id: target?.id || '', dataset },
  });
}

/** 页面模板的渲染上下文：读 data，外加 __ev / __asset 两个辅助函数。 */
function pageContext(entry: PageEntry): Record<string, unknown> {
  const helpers: Record<string, unknown> = {
    __ev: (name: string, ev: Event, dataset: Record<string, unknown>, kind: string) => dispatch(entry, name, ev, dataset, kind),
    __asset: assetUrl,
  };
  return new Proxy({}, {
    get: (_, key: string) => (key in helpers ? helpers[key] : entry.inst.data[key]),
    has: (_, key: string) => key in helpers || key in entry.inst.data,
  });
}

const PAGE_KEY = Symbol('wx-page');

const PageHost = defineComponent({
  name: 'WxPageHost',
  props: { entry: { type: Object as PropType<PageEntry>, required: true }, active: Boolean },
  setup(props) {
    const ctx = pageContext(props.entry);
    const cache: unknown[] = [];
    provide(PAGE_KEY, { ctx, templates: props.entry.module.templates });
    return () => h('div', {
      class: ['wx-page', props.active ? 'wx-page-active' : ''],
      'data-route': props.entry.route,
      style: props.active ? undefined : { display: 'none' },
      'aria-hidden': props.active ? undefined : 'true',
    }, [props.entry.module.render(ctx, cache) as never]);
  },
});

/** <template is="x" data="{{...}}"/>：模板里的变量只来自 data，事件仍交给所在页面。 */
const WxTpl = defineComponent({
  name: 'WxTpl',
  props: { name: { type: String, required: true }, data: { type: Object, default: () => ({}) } },
  setup(props) {
    const page = inject<{ ctx: Record<string, unknown>; templates: Record<string, RenderFn> }>(PAGE_KEY)!;
    const cache: unknown[] = [];
    const ctx = new Proxy({}, {
      get: (_, key: string) => (key in props.data ? (props.data as Record<string, unknown>)[key] : page.ctx[key]),
      has: () => true,
    });
    return () => {
      const render = page.templates[props.name];
      if (!render) { console.warn(`模板 ${props.name} 未定义`); return null; }
      return render(ctx, cache) as never;
    };
  },
});

const hoverDirective: Directive<HTMLElement & { __wxHover?: () => void }, string> = {
  mounted(el, binding) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const add = () => { if (!(el as HTMLButtonElement).disabled) el.classList.add(binding.value); };
    const remove = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => el.classList.remove(binding.value), 70); };
    el.addEventListener('pointerdown', add);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, remove));
  },
};

const longpressDirective: Directive<HTMLElement & { __wxSuppressTap?: boolean }, (e: Event) => void> = {
  mounted(el, binding) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointerdown', (e) => {
      startX = e.clientX; startY = e.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        el.__wxSuppressTap = true;
        setTimeout(() => { el.__wxSuppressTap = false; }, 800);
        (el as unknown as { __wxLong: (e: Event) => void }).__wxLong(e);
      }, 500);
    });
    el.addEventListener('pointermove', (e) => { if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) cancel(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, cancel));
    // 电脑上用右键代替长按
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); (el as unknown as { __wxLong: (e: Event) => void }).__wxLong(e); });
    (el as unknown as { __wxLong: (e: Event) => void }).__wxLong = binding.value;
  },
  updated(el, binding) { (el as unknown as { __wxLong: (e: Event) => void }).__wxLong = binding.value; },
};

const NavBar = defineComponent({
  name: 'WxNavBar',
  setup() {
    const top = computed(() => stack[stack.length - 1]);
    return () => {
      const entry = top.value;
      const canBack = stack.length > 1;
      const showHome = !canBack && entry && entry.route !== HOME_ROUTE;
      const refreshable = entry && entry.module.config.enablePullDownRefresh;
      const atHome = entry && entry.route === HOME_ROUTE;
      return h('header', { class: 'wx-navbar' }, [
        h('div', { class: 'wx-navbar-side' }, [
          canBack ? h('button', { type: 'button', class: 'wx-navbar-btn', 'aria-label': '返回上一页', onClick: () => navigateBack(1) }, '‹ 返回') : null,
          showHome ? h('button', { type: 'button', class: 'wx-navbar-btn', 'aria-label': '回到首页', onClick: () => reLaunch(`/${HOME_ROUTE}`) }, '⌂ 首页') : null,
        ]),
        h('div', { class: 'wx-navbar-title' }, entry?.module.config.navigationBarTitleText || '菜品质构识别'),
        h('div', { class: 'wx-navbar-side wx-navbar-right' }, [
          refreshable ? h('button', { type: 'button', class: 'wx-navbar-btn', 'aria-label': '刷新', disabled: ui.refreshing, onClick: () => triggerRefresh() }, '↻') : null,
          atHome ? h('button', { type: 'button', class: 'wx-navbar-btn wx-navbar-account', onClick: () => void logout() }, session.role === 'participant' ? '退出' : '退出调研员') : null,
        ]),
      ]);
    };
  },
});

function triggerRefresh(): void {
  const entry = stack[stack.length - 1];
  if (!entry || !entry.module.config.enablePullDownRefresh || ui.refreshing) return;
  if (typeof entry.inst.onPullDownRefresh !== 'function') return;
  ui.refreshing = true;
  const guard = setTimeout(() => { ui.refreshing = false; }, 15000);
  onPullRefreshStop(() => clearTimeout(guard));
  callHook(entry.inst, 'onPullDownRefresh');
}

/** 触屏下拉刷新（仅对 enablePullDownRefresh 的页面） */
function installPullToRefresh(): void {
  let startY = -1;
  window.addEventListener('touchstart', (e) => {
    startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : -1;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (startY < 0 || ui.refreshing) return;
    const entry = stack[stack.length - 1];
    if (!entry || !entry.module.config.enablePullDownRefresh) return;
    ui.pullDistance = Math.max(0, Math.min(90, (e.touches[0].clientY - startY) * 0.5));
  }, { passive: true });
  window.addEventListener('touchend', () => {
    if (startY >= 0 && ui.pullDistance >= 56) triggerRefresh();
    if (!ui.refreshing) ui.pullDistance = 0;
    startY = -1;
  });
}

/** 滚到底触发 onReachBottom（问卷记录分页） */
function installReachBottom(): void {
  let armed = true;
  window.addEventListener('scroll', () => {
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 60;
    if (nearBottom && armed) {
      armed = false;
      const entry = stack[stack.length - 1];
      if (entry) callHook(entry.inst, 'onReachBottom');
    } else if (!nearBottom) armed = true;
  }, { passive: true });
}

/** 桌面浏览器点日期文字时也弹出日期选择 */
function installPickerHelper(): void {
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLInputElement;
    if (t && t.classList && t.classList.contains('wx-picker-native') && typeof t.showPicker === 'function') {
      try { t.showPicker(); } catch { /* 部分浏览器要求用户手势，忽略 */ }
    }
  });
}

export const Root = defineComponent({
  name: 'WxRoot',
  setup() {
    installPullToRefresh();
    installReachBottom();
    installPickerHelper();
    return () => h('div', { class: ['wx-app', session.role === 'participant' ? 'role-participant' : 'role-researcher'] }, [
      h(NavBar),
      ui.refreshing || ui.pullDistance > 0
        ? h('div', { class: 'wx-pull', style: { height: `${ui.refreshing ? 48 : ui.pullDistance}px` } }, ui.refreshing ? '正在刷新…' : (ui.pullDistance >= 56 ? '松开刷新' : '下拉刷新'))
        : null,
      ...stack.map((entry, i) => h(PageHost, { key: entry.id, entry, active: i === stack.length - 1 })),
      h(Overlays),
    ]);
  },
});

export function installRuntime(app: App): void {
  app.component('wx-tpl', WxTpl);
  app.directive('wx-hover', hoverDirective);
  app.directive('wx-longpress', longpressDirective);
}
