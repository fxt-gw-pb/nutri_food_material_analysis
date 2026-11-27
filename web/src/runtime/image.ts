// 选图与压缩：对应 wx.chooseMedia({ sizeType: ['compressed'] })。
//
// 不加 capture 属性：部分安卓微信内置浏览器加了它就只能拍照、不能从相册选。
// 上传前在本机缩到长边 1600px、JPEG 质量 0.85（超过 600 KB 再降一档），
// 一般 300–500 KB；EXIF 方向由 createImageBitmap 的 imageOrientation 处理。

const MAX_EDGE = 1600;
const TARGET_BYTES = 600 * 1024;

export interface ChosenImage { tempFilePath: string; size: number; width: number; height: number; fileType: 'image' }

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // 旧版 WebView 不认识 options，退回 <img> 解码（现代浏览器默认按 EXIF 方向绘制）。
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))), 'image/jpeg', quality);
  });
}

export async function compressImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const source = await decode(file);
  const w = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const hgt = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!w || !hgt) throw new Error('无法读取这张照片');
  const scale = Math.min(1, MAX_EDGE / Math.max(w, hgt));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(hgt * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持图片处理');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  if ('close' in source) source.close();
  let blob = await toBlob(canvas, 0.85);
  if (blob.size > TARGET_BYTES) blob = await toBlob(canvas, 0.75);
  return { blob, width, height };
}

export async function chooseImage(): Promise<ChosenImage | null> {
  const file = await pickFile();
  if (!file) return null;
  const { blob, width, height } = await compressImage(file);
  return { tempFilePath: URL.createObjectURL(blob), size: blob.size, width, height, fileType: 'image' };
}
