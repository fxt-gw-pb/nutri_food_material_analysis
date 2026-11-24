/** 当前正在拍摄的饭局。只保存会话 id，不保存菜品数据。 */
const ACTIVE_SESSION_KEY = 'active_meal_session_v1';

function newId(): string {
  return `meal_session_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

export function getActiveMealSession(): string | null {
  const value = wx.getStorageSync(ACTIVE_SESSION_KEY);
  return typeof value === 'string' && value ? value : null;
}

export function startMealSession(): string {
  const id = newId();
  wx.setStorageSync(ACTIVE_SESSION_KEY, id);
  return id;
}

export function ensureMealSession(id?: string): string {
  if (id) {
    wx.setStorageSync(ACTIVE_SESSION_KEY, id);
    return id;
  }
  return getActiveMealSession() || startMealSession();
}

export function clearMealSession(id?: string): void {
  if (!id || getActiveMealSession() === id) wx.removeStorageSync(ACTIVE_SESSION_KEY);
}
