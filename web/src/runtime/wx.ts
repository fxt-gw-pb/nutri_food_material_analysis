// wx.* 的网页实现。只实现本项目页面实际用到的接口；其余接口一律报错，避免静默失效。
import { apiRequest } from '../api';
import { chooseImage } from './image';
import { currentPages, navigateBack, navigateTo, redirectTo, reLaunch } from './router';
import { hideLoading, hideToast, previewImage, showLoading, showModal, showToast, ui } from './ui';

type Callbacks<T> = { success?: (r: T) => void; fail?: (e: unknown) => void; complete?: (r: unknown) => void };

/** 小程序异步接口的统一形态：既回调 success/fail/complete，也返回 Promise。 */
function run<T>(opts: Callbacks<T> | undefined, task: () => Promise<T>): Promise<T> {
  const p = task();
  p.then((r) => { opts?.success?.(r); opts?.complete?.(r); }, (e) => { opts?.fail?.(e); opts?.complete?.(e); });
  // 只传回调、不 await 的调用方，失败已经交给 fail；这里吞掉未处理的拒绝，免得控制台报错。
  if (opts && (opts.fail || opts.complete)) p.catch(() => undefined);
  return p;
}

const STORAGE_PREFIX = 'wx:';

function getStorageSync(key: string): unknown {
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_PREFIX + key); } catch { return ''; }
  if (raw === null) return '';
  try { return JSON.parse(raw); } catch { return ''; }
}

function setStorageSync(key: string, value: unknown): void {
  // 写失败（隐私模式、空间满）必须抛出，页面据此提示“未保存”。
  localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value === undefined ? null : value));
}

function removeStorageSync(key: string): void {
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* 忽略 */ }
}

let refreshDone: (() => void) | null = null;
export function onPullRefreshStop(fn: () => void): void { refreshDone = fn; }

function unsupported(name: string) {
  return () => { throw new Error(`网页版未实现 wx.${name}`); };
}

export const wx = {
  getStorageSync,
  setStorageSync,
  removeStorageSync,

  showToast: (opts: { title?: string; icon?: string; duration?: number; mask?: boolean } & Callbacks<void>) =>
    run(opts, async () => showToast(opts)),
  hideToast: () => hideToast(),
  showLoading: (opts: { title?: string; mask?: boolean } & Callbacks<void>) => run(opts, async () => showLoading(opts)),
  hideLoading: (opts?: Callbacks<void>) => run(opts, async () => hideLoading()),
  showModal: (opts: Parameters<typeof showModal>[0] & Callbacks<{ confirm: boolean; cancel: boolean }>) =>
    run(opts, () => showModal(opts).then((r) => ({ ...r, errMsg: 'showModal:ok' }))),
  previewImage: (opts: { urls: string[]; current?: string } & Callbacks<void>) => run(opts, async () => previewImage(opts.urls, opts.current)),

  navigateTo: (opts: { url: string } & Callbacks<void>) => run(opts, () => navigateTo(opts.url)),
  redirectTo: (opts: { url: string } & Callbacks<void>) => run(opts, () => redirectTo(opts.url)),
  reLaunch: (opts: { url: string } & Callbacks<void>) => run(opts, () => reLaunch(opts.url)),
  navigateBack: (opts?: { delta?: number } & Callbacks<void>) => run(opts, () => navigateBack(opts?.delta)),

  pageScrollTo: (opts: { scrollTop?: number; selector?: string; duration?: number } & Callbacks<void>) => run(opts, async () => {
    const behavior: ScrollBehavior = opts.duration ? 'smooth' : 'auto';
    if (opts.selector) {
      const page = document.querySelector('.wx-page-active');
      const el = (page || document).querySelector(opts.selector);
      if (el) {
        const navHeight = (document.querySelector('.wx-navbar') as HTMLElement | null)?.offsetHeight || 0;
        window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - navHeight - 8, behavior });
      }
      return;
    }
    window.scrollTo({ top: opts.scrollTop || 0, behavior });
  }),
  stopPullDownRefresh: () => {
    ui.refreshing = false;
    ui.pullDistance = 0;
    if (refreshDone) { const fn = refreshDone; refreshDone = null; fn(); }
  },

  chooseMedia: (opts: { count?: number } & Callbacks<{ tempFiles: { tempFilePath: string; size: number; fileType: string }[]; type: string }>) =>
    run(opts, async () => {
      let image;
      try {
        image = await chooseImage();
      } catch (err) {
        console.error('[chooseMedia] 读取照片失败', err);
        showToast({ title: '这张照片读取失败，请换一张', icon: 'none' });
        throw err;
      }
      if (!image) throw new Error('chooseMedia:fail cancel');
      return { tempFiles: [{ tempFilePath: image.tempFilePath, size: image.size, fileType: 'image' }], type: 'image' };
    }),

  cloud: {
    init: () => undefined,
    callFunction: (opts: { name: string; data?: Record<string, unknown> } & Callbacks<{ result: unknown }>) =>
      run(opts, async () => ({ result: await apiRequest('POST', `/api/cloud/${encodeURIComponent(opts.name)}`, opts.data || {}), errMsg: 'cloud.callFunction:ok' })),
    database: unsupported('cloud.database'),
    uploadFile: unsupported('cloud.uploadFile'),
    deleteFile: unsupported('cloud.deleteFile'),
  },
};

export function installGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.wx = wx;
  g.getCurrentPages = currentPages;
  g.getApp = () => ({ globalData: {} });
  g.App = () => undefined;
}
