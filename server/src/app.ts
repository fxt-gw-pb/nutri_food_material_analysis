// 组装 HTTP 服务：公开页面、登录、前端静态文件（需登录）、业务接口。
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Auth, Session } from './auth';
import { ServerConfig } from './config';
import { Store } from './db';
import { HttpError, readBody, readForm, readJson, redirect, RequestContext, Router, sendHtml, sendJson } from './http';
import { Images, MAX_IMAGE_BYTES } from './images';
import { Meals } from './meals';
import { invalidLinkPage, landingPage, loginPage, notFoundPage } from './pages';
import { questionnaireAction } from './questionnaire';
import { VisionQueue } from './vision';

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self)',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

export interface AppDeps { store: Store; queue: VisionQueue; images: Images; auth: Auth; meals: Meals }

export function createDeps(config: ServerConfig, store = new Store(config.dataDir)): AppDeps {
  const images = new Images(store);
  const queue = new VisionQueue(store, images, { mock: config.visionMock, concurrency: config.visionConcurrency });
  const auth = new Auth(store, config);
  const meals = new Meals(store, images, queue, config.visionMock);
  return { store, queue, images, auth, meals };
}

export function createServer(config: ServerConfig, deps: AppDeps = createDeps(config)): http.Server {
  const { store, auth, images, meals } = deps;
  const router = new Router();
  const api = (fn: (ctx: RequestContext, session: Session) => unknown) => async (ctx: RequestContext) => {
    const session = auth.require(ctx.req, ctx.res);
    const result = await fn(ctx, session);
    if (!ctx.res.headersSent) sendJson(ctx.res, 200, result === undefined ? { ok: true } : result);
  };

  // ---- 公开页面与登录 -----------------------------------------------------------
  router.on('GET', '/', ({ res }) => sendHtml(res, 200, landingPage(config)));
  router.on('GET', '/healthz', ({ res }) => sendJson(res, 200, { ok: true, queue: deps.queue.pending }));
  router.on('GET', '/robots.txt', ({ res }) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nDisallow: /\n'); });
  router.on('GET', '/login', ({ res, url }) => sendHtml(res, 200, loginPage(config, url.searchParams)));
  router.on('POST', '/login', async ({ req, res, ip }) => {
    const form = await readForm(req);
    let ok = false;
    try {
      ok = auth.checkPasscode(ip, form.get('passcode') || '');
    } catch (err) {
      const code = err instanceof HttpError && err.status === 429 ? 'limited' : 'unset';
      redirect(res, `/login?error=${code}`);
      return;
    }
    if (!ok) { redirect(res, '/login?error=wrong'); return; }
    auth.createSession(res, 'researcher', null, null);
    redirect(res, '/app/');
  });
  router.on('GET', '/p/:token', ({ res, params }) => {
    const participant = auth.participantByToken(params.token);
    if (!participant) { sendHtml(res, 404, invalidLinkPage(config)); return; }
    auth.createSession(res, 'participant', participant.code, participant.tokenIssuedAt);
    redirect(res, '/app/');
  });
  router.on('POST', '/api/auth/logout', ({ req, res }) => { auth.logout(req, res); sendJson(res, 200, { ok: true }); });
  router.on('GET', '/logout', ({ req, res }) => { auth.logout(req, res); redirect(res, '/login'); });
  router.on('GET', '/api/session', api((_, s) => ({ role: s.role, participantCode: s.participantCode, label: s.role === 'participant' ? `参与者 ${s.participantCode}` : '调研员' })));

  // ---- 照片 -----------------------------------------------------------------------
  router.on('POST', '/api/images', api(async ({ req }, s) => {
    const buf = await readBody(req, MAX_IMAGE_BYTES);
    const img = images.save(s, buf);
    return { fileId: img.id, imageUrl: `/api/images/${img.id}` };
  }));
  router.on('GET', '/api/images/:id', ({ req, res, params }) => {
    const s = auth.require(req, res);
    const img = images.get(params.id);
    if (!img || !images.canRead(s, img)) throw new HttpError(404, '照片不存在', 'NOT_FOUND');
    images.send(res, img);
  });

  // ---- 识别记录（顺序：先注册固定路径，再注册 :id） --------------------------------
  router.on('GET', '/api/meals', api(({ url }, s) => {
    if (url.searchParams.get('view') !== 'history') throw new HttpError(400, '不支持的查询');
    return meals.history(s);
  }));
  router.on('POST', '/api/meals', api(async ({ req }, s) => meals.create(s, await readJson(req))));
  router.on('GET', '/api/meals/pending-legacy', api((_, s) => meals.pendingLegacy(s)));
  router.on('GET', '/api/meals/range', api(({ url }, s) => meals.range(s, url.searchParams)));
  router.on('GET', '/api/meals/:id', api(({ params }, s) => meals.result(s, params.id)));
  router.on('DELETE', '/api/meals/:id', api(({ params }, s) => { meals.remove(s, params.id); }));
  router.on('GET', '/api/meals/:id/status', api(({ params }, s) => meals.status(s, params.id)));
  router.on('PUT', '/api/meals/:id/selections', api(async ({ req, params }, s) => { meals.saveSelections(s, params.id, await readJson(req)); }));
  router.on('PUT', '/api/meals/:id/meal-type', api(async ({ req, params }, s) => { meals.saveMealType(s, params.id, await readJson(req)); }));
  router.on('PUT', '/api/meals/:id/excluded', api(async ({ req, params }, s) => { meals.saveExcluded(s, params.id, await readJson(req)); }));
  router.on('PUT', '/api/meals/:id/consumption', api(async ({ req, params }, s) => { meals.saveConsumption(s, params.id, await readJson(req)); }));
  router.on('POST', '/api/meals/:id/audit-snapshot', api(({ params }, s) => { meals.saveAuditSnapshot(s, params.id); }));
  router.on('POST', '/api/meals/:id/discard', api(({ params }, s) => { meals.discard(s, params.id); }));
  router.on('POST', '/api/meal-sessions/:id/finish', api(({ params }, s) => { meals.finishSession(s, params.id); }));

  // ---- 随访问卷（对应 wx.cloud.callFunction({ name: 'questionnaire' })） ----------
  router.on('POST', '/api/cloud/questionnaire', api(async ({ req }, s) => questionnaireAction(store, s, await readJson(req))));

  // ---- 前端（登录后才下发：包内含《中国食物成分表》数据，不能公开） ----------------
  const serveApp = ({ req, res, url }: RequestContext) => {
    const session = auth.session(req, res);
    if (!session) { redirect(res, '/login'); return; }
    let rel = decodeURIComponent(url.pathname.replace(/^\/app\/?/, ''));
    if (!rel) rel = 'index.html';
    const file = path.resolve(config.webDist, rel);
    if (!file.startsWith(path.resolve(config.webDist) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      sendHtml(res, 404, notFoundPage(config));
      return;
    }
    const ext = path.extname(file);
    const cache = rel.startsWith('_app/') ? 'private, max-age=31536000, immutable' : rel === 'index.html' ? 'no-cache' : 'private, max-age=86400';
    const stat = fs.statSync(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': cache });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  };

  return http.createServer(async (req, res) => {
    const started = Date.now();
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    const ip = (config.trustProxy && String(req.headers['x-real-ip'] || '')) || req.socket.remoteAddress || '';
    let url: URL;
    try { url = new URL(req.url || '/', 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
    const ctx: RequestContext = { req, res, url, params: {}, ip };
    if (process.env.ACCESS_LOG !== '0') {
      const shown = url.pathname.startsWith('/p/') ? '/p/<令牌>' : url.pathname;
      res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${shown} ${res.statusCode} ${Date.now() - started}ms`));
    }
    try {
      const method = req.method || 'GET';
      // 写操作必须来自本站页面：要求自定义头（跨站表单发不出来），并核对 Origin。
      if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(method)) {
        if (req.headers['x-web-client'] !== '1') throw new HttpError(403, '请求来源无效', 'BAD_ORIGIN');
      }
      if (!['GET', 'HEAD'].includes(method) && req.headers.origin && config.publicOrigin && req.headers.origin !== config.publicOrigin) {
        throw new HttpError(403, '请求来源无效', 'BAD_ORIGIN');
      }
      if (url.pathname === '/app') { redirect(res, '/app/'); return; }
      if (url.pathname.startsWith('/app/') && (method === 'GET' || method === 'HEAD')) { serveApp(ctx); return; }
      const match = router.match(method, url.pathname);
      if (match === 'method') throw new HttpError(405, '不支持的请求方法', 'METHOD_NOT_ALLOWED');
      if (!match) {
        if (url.pathname.startsWith('/api/')) throw new HttpError(404, '接口不存在', 'NOT_FOUND');
        sendHtml(res, 404, notFoundPage(config));
        return;
      }
      ctx.params = match.params;
      await match.handler(ctx);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[server]', req.method, url.pathname, err);
      if (!res.headersSent) {
        sendJson(res, status, { ok: false, code: err instanceof HttpError ? err.code : 'INTERNAL', message: err instanceof HttpError ? err.message : '服务器出错，请稍后重试' });
      } else res.end();
    }
  });
}
