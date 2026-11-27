// 极简 HTTP 工具：路由、请求体读取、JSON 响应、业务错误。只用 Node 内置模块。
import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'BAD_REQUEST') { super(message); }
}

export type Params = Record<string, string>;
export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Params;
  ip: string;
}
export type Handler = (ctx: RequestContext) => Promise<void> | void;

interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const pattern = new RegExp(`^${path.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`);
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }

  match(method: string, pathname: string): { handler: Handler; params: Params } | null | 'method' {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method && !(route.method === 'GET' && method === 'HEAD')) continue;
      const params: Params = {};
      route.keys.forEach((key, i) => {
        try { params[key] = decodeURIComponent(m[i + 1]); } catch { params[key] = m[i + 1]; }
      });
      return { handler: route.handler, params };
    }
    return pathMatched ? 'method' : null;
  }
}

export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new HttpError(413, '上传内容太大', 'TOO_LARGE')); req.resume(); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(new HttpError(413, '上传内容太大', 'TOO_LARGE')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson<T = Record<string, unknown>>(req: IncomingMessage, limit = 256 * 1024): Promise<T> {
  const type = String(req.headers['content-type'] || '');
  if (!type.startsWith('application/json')) throw new HttpError(415, '请求格式不正确', 'UNSUPPORTED_MEDIA_TYPE');
  const buf = await readBody(req, limit);
  if (!buf.length) return {} as T;
  try {
    const value = JSON.parse(buf.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    return value as T;
  } catch {
    throw new HttpError(400, '请求内容不是合法 JSON', 'INVALID_JSON');
  }
}

export async function readForm(req: IncomingMessage, limit = 16 * 1024): Promise<URLSearchParams> {
  const buf = await readBody(req, limit);
  return new URLSearchParams(buf.toString('utf8'));
}

export function sendJson(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  const body = Buffer.from(JSON.stringify(value === undefined ? null : value), 'utf8');
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function sendHtml(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function redirect(res: ServerResponse, location: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    try { out[key] = decodeURIComponent(part.slice(idx + 1).trim()); } catch { /* 忽略损坏的 cookie */ }
  });
  return out;
}

export function str(value: unknown, field: string, { max = 200, allowEmpty = false } = {}): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} 必须是文本`);
  const v = value.trim();
  if (!allowEmpty && !v) throw new HttpError(400, `缺少 ${field}`);
  if (v.length > max) throw new HttpError(400, `${field} 太长`);
  return v;
}
