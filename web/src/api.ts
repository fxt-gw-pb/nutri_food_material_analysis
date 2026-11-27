// 与自建后端通信。所有请求带同源 Cookie（登录态），写操作额外带 X-Web-Client 头防跨站伪造。

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

let redirecting = false;
function goLogin(): void {
  if (redirecting) return;
  redirecting = true;
  location.href = '/login?expired=1';
}

export async function apiRequest<T = unknown>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Web-Client': '1', Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    payload = body;
    headers['Content-Type'] = body.type || 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new ApiError('网络连接失败，请检查网络后重试', 0, 'NETWORK');
  }
  if (response.status === 401) {
    goLogin();
    throw new ApiError('登录已失效，请重新登录', 401, 'UNAUTHENTICATED');
  }
  const text = await response.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const err = (data || {}) as { message?: string; code?: string };
    throw new ApiError(err.message || `服务暂不可用（${response.status}）`, response.status, err.code || 'HTTP_ERROR');
  }
  return data as T;
}

export interface SessionInfo { role: 'researcher' | 'participant'; participantCode: string | null; label: string }

export function fetchSession(): Promise<SessionInfo> {
  return apiRequest<SessionInfo>('GET', '/api/session');
}

export async function logout(): Promise<void> {
  try { await apiRequest('POST', '/api/auth/logout', {}); } finally { location.href = '/login'; }
}
