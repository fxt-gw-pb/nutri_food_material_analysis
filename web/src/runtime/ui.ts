// 提示框、对话框、加载遮罩、图片预览：对应 wx.showToast / showModal / showLoading / previewImage。
import { defineComponent, h, reactive } from 'vue';

interface ModalRequest {
  title: string;
  content: string;
  showCancel: boolean;
  cancelText: string;
  confirmText: string;
  cancelColor: string;
  confirmColor: string;
  resolve: (r: { confirm: boolean; cancel: boolean }) => void;
}

export const ui = reactive({
  toast: null as null | { title: string; icon: string; mask: boolean; loading: boolean },
  modal: null as null | ModalRequest,
  preview: null as null | { urls: string[]; index: number },
  refreshing: false,
  pullDistance: 0,
});

const modalQueue: ModalRequest[] = [];
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(opts: { title?: string; icon?: string; duration?: number; mask?: boolean }): void {
  if (toastTimer) clearTimeout(toastTimer);
  ui.toast = { title: opts.title || '', icon: opts.icon || 'success', mask: !!opts.mask, loading: false };
  toastTimer = setTimeout(() => { ui.toast = null; toastTimer = null; }, opts.duration ?? 1500);
}

export function showLoading(opts: { title?: string; mask?: boolean }): void {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  ui.toast = { title: opts.title || '', icon: 'loading', mask: !!opts.mask, loading: true };
}

export function hideLoading(): void {
  if (ui.toast && ui.toast.loading) ui.toast = null;
}

export function hideToast(): void {
  if (ui.toast && !ui.toast.loading) ui.toast = null;
}

export function showModal(opts: Partial<Omit<ModalRequest, 'resolve'>>): Promise<{ confirm: boolean; cancel: boolean }> {
  return new Promise((resolve) => {
    const request: ModalRequest = {
      title: opts.title || '', content: opts.content || '', showCancel: opts.showCancel !== false,
      cancelText: opts.cancelText || '取消', confirmText: opts.confirmText || '确定',
      cancelColor: opts.cancelColor || '#5d7065', confirmColor: opts.confirmColor || '#246b56', resolve,
    };
    if (ui.modal) modalQueue.push(request); else ui.modal = request;
  });
}

function closeModal(confirm: boolean): void {
  const current = ui.modal;
  if (!current) return;
  ui.modal = modalQueue.shift() || null;
  current.resolve({ confirm, cancel: !confirm });
}

export function previewImage(urls: string[], current?: string): void {
  if (!urls.length) return;
  const index = Math.max(0, current ? urls.indexOf(current) : 0);
  ui.preview = { urls, index };
}

const ICONS: Record<string, string> = { success: '✓', error: '✕' };

export const Overlays = defineComponent({
  name: 'WxOverlays',
  setup() {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ui.preview) ui.preview = null;
    };
    window.addEventListener('keydown', onKey);
    return () => {
      const nodes = [];
      if (ui.toast) {
        const t = ui.toast;
        const iconNode = t.loading
          ? h('span', { class: 'wx-toast-spinner', 'aria-hidden': 'true' })
          : ICONS[t.icon] ? h('span', { class: 'wx-toast-icon', 'aria-hidden': 'true' }, ICONS[t.icon]) : null;
        nodes.push(h('div', { class: ['wx-toast-layer', t.mask || t.loading ? 'wx-toast-mask' : ''] }, [
          h('div', { class: ['wx-toast', iconNode ? 'wx-toast-with-icon' : 'wx-toast-text'], role: 'status', 'aria-live': 'polite' }, [
            iconNode, h('div', { class: 'wx-toast-title' }, t.title),
          ]),
        ]));
      }
      if (ui.modal) {
        const m = ui.modal;
        nodes.push(h('div', { class: 'wx-modal-layer' }, [
          h('div', { class: 'wx-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.title || '提示' }, [
            m.title ? h('div', { class: 'wx-modal-title' }, m.title) : null,
            m.content ? h('div', { class: 'wx-modal-content' }, m.content) : null,
            h('div', { class: 'wx-modal-actions' }, [
              m.showCancel ? h('button', { type: 'button', class: 'wx-modal-btn', style: { color: m.cancelColor }, onClick: () => closeModal(false) }, m.cancelText) : null,
              h('button', { type: 'button', class: 'wx-modal-btn wx-modal-confirm', style: { color: m.confirmColor }, onClick: () => closeModal(true) }, m.confirmText),
            ]),
          ]),
        ]));
      }
      if (ui.preview) {
        const p = ui.preview;
        nodes.push(h('div', { class: 'wx-preview', role: 'dialog', 'aria-label': '查看大图', onClick: () => { ui.preview = null; } }, [
          h('img', { class: 'wx-preview-img', src: p.urls[p.index], alt: '菜品照片大图' }),
          h('div', { class: 'wx-preview-hint' }, '轻触任意处关闭'),
        ]));
      }
      return nodes;
    };
  },
});
