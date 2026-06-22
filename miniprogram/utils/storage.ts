// 本地 Storage 读写封装。
// mock 阶段用它持久化分析记录，模拟云数据库；接入 CloudBase 后由数据库取代。

export function safeGet<T>(key: string, fallback: T): T {
  try {
    const value = wx.getStorageSync(key);
    if (value === '' || value === undefined || value === null) {
      return fallback;
    }
    return value as T;
  } catch (e) {
    console.error('[storage] read failed:', key, e);
    return fallback;
  }
}

export function safeSet<T>(key: string, value: T): void {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    console.error('[storage] write failed:', key, e);
  }
}
