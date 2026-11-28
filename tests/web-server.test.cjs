// 网页版后端：登录与封闭访问、识别全流程、问卷、导出兼容。识别调用用假的千问替身，不联网。
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText, filename);

process.env.ACCESS_LOG = '0';
const { createServer } = require('../server/src/app.ts');
const { Store } = require('../server/src/db.ts');
const { Images } = require('../server/src/images.ts');
const { VisionQueue } = require('../server/src/vision.ts');
const { Auth } = require('../server/src/auth.ts');
const { Meals } = require('../server/src/meals.ts');
const { loadConfig } = require('../server/src/config.ts');
const { parseRecords, exportFile } = require('../scripts/export/core.cjs');

const DISH = {
  dishName: '番茄炒蛋', cookingMethod: '炒', recognitionConfidence: 'high', weightConfidence: 'medium',
  ingredients: [
    { name: '鸡蛋', cookingMethod: '炒', areaRatio: 0.3, heightCm: 1.5, estimatedG: 90, weightConfidence: 'medium' },
    { name: '番茄', cookingMethod: '炒', areaRatio: 0.25, heightCm: 1.5, estimatedG: 80, weightConfidence: 'medium' },
  ],
};
const ANSWERS = { q1: ['never'], q2: ['sometimes'], q3: ['often'], q4: ['never'], q5: ['most'], q6: ['none'] };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

let dir; let server; let base; let deps; let visionImpl;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'food-web-test-'));
  const config = loadConfig({ DATA_DIR: dir, WEB_DIST: path.join(dir, 'dist'), RESEARCHER_PASSCODE: 'pw-123' }, dir);
  fs.mkdirSync(config.webDist, { recursive: true });
  fs.writeFileSync(path.join(config.webDist, 'index.html'), '<!doctype html><div id="app"></div>');
  const store = new Store(dir);
  const images = new Images(store);
  visionImpl = async () => ({ dish: JSON.parse(JSON.stringify(DISH)), modelName: 'qwen3.8-max-0902', promptVersion: 'qwen-dish-visible-food-weight-v8', requestId: 'r1' });
  const queue = new VisionQueue(store, images, { mock: false, concurrency: 1 }, (...a) => visionImpl(...a));
  deps = { store, images, queue, auth: new Auth(store, config), meals: new Meals(store, images, queue, false) };
  server = createServer(config, deps);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); deps.store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/** 带 Cookie 的简易客户端 */
function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const init = { method, redirect: 'manual', headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } };
    if (Buffer.isBuffer(body)) { init.body = body; init.headers['Content-Type'] = 'image/jpeg'; }
    else if (typeof body === 'string') { init.body = body; init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    if (method !== 'GET' && url.startsWith('/api/') && !('X-Web-Client' in headers)) init.headers['X-Web-Client'] = '1';
    const res = await fetch(base + url, init);
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, location: res.headers.get('location') };
  };
  return { call, get cookie() { return cookie; } };
}
async function researcher() {
  const c = client();
  const r = await c.call('POST', '/login', 'passcode=pw-123');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/app/');
  return c;
}
async function participant(code) {
  const c = client();
  const token = deps.auth.issueParticipantToken(code);
  const r = await c.call('GET', `/p/${token}`);
  assert.equal(r.status, 303);
  return c;
}
async function completedMeal(c, code, mealSessionId = 's1') {
  const img = await c.call('POST', '/api/images', JPEG);
  assert.equal(img.status, 200, JSON.stringify(img.data));
  const created = await c.call('POST', '/api/meals', { imageFileId: img.data.fileId, plateDiameterCm: 26, participantCode: code, mealSessionId });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  for (let i = 0; i < 50; i += 1) {
    const s = await c.call('GET', `/api/meals/${created.data.analysisId}/status`);
    if (s.data.status === 'completed' || s.data.status === 'failed') return { id: created.data.analysisId, status: s.data, fileId: img.data.fileId };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('识别没有结束');
}

test('未登录：接口 401，前端页面跳转登录，公开首页可访问', async () => {
  const c = client();
  assert.equal((await c.call('GET', '/api/session')).status, 401);
  const app = await c.call('GET', '/app/');
  assert.equal(app.status, 303);
  assert.equal(app.location, '/login');
  assert.equal((await c.call('GET', '/')).status, 200);
  assert.equal((await c.call('GET', '/p/not-a-real-token-xxxxxxxxxxxx')).status, 404);
});

test('调研员口令：错口令不登录，对口令登录后可取前端', async () => {
  const c = client();
  const wrong = await c.call('POST', '/login', 'passcode=nope');
  assert.equal(wrong.location, '/login?error=wrong');
  assert.equal(c.cookie, '');
  const ok = await researcher();
  assert.deepEqual((await ok.call('GET', '/api/session')).data, { role: 'researcher', participantCode: null, label: '调研员' });
  assert.equal((await ok.call('GET', '/app/')).status, 200);
  assert.equal((await ok.call('GET', '/app/../../etc/passwd')).status, 404);
});

test('写操作必须带 X-Web-Client 头', async () => {
  const c = await researcher();
  const r = await c.call('POST', '/api/meals', { participantCode: '001207' }, { 'X-Web-Client': '0' });
  assert.equal(r.status, 403);
});

test('识别全流程：上传 → 识别 → 改选 → 结束本顿 → 饭后评估，落库字段与小程序一致', async () => {
  const c = await researcher();
  const { id, status, fileId } = await completedMeal(c, '001207');
  assert.deepEqual(status, { status: 'completed', progress: 1, errorStage: '', errorMessage: '' });
  const meal = (await c.call('GET', `/api/meals/${id}`)).data;
  assert.equal(meal.participantCode, '001207');
  assert.equal(meal.dish.dishName, '番茄炒蛋');
  assert.equal(meal.imageUrl, `/api/images/${fileId}`);
  assert.equal(meal.evaluationStatus, 'pending');
  const photo = await c.call('GET', meal.imageUrl);
  assert.equal(Buffer.from(photo.data).length, JPEG.length);

  assert.equal((await c.call('PUT', `/api/meals/${id}/meal-type`, { mealType: 'lunch' })).status, 200);
  assert.equal((await c.call('PUT', `/api/meals/${id}/meal-type`, { mealType: 'brunch' })).status, 400);
  assert.equal((await c.call('PUT', `/api/meals/${id}/selections`, { selections: { 鸡蛋: 'x1' } })).status, 200);
  assert.equal((await c.call('PUT', `/api/meals/${id}/selections`, { selections: {} })).status, 200);
  assert.equal((await c.call('POST', `/api/meals/${id}/audit-snapshot`, {})).status, 200);
  assert.equal((await c.call('PUT', `/api/meals/${id}/consumption`, { percentages: { 鸡蛋: 100 }, complete: false })).status, 200);
  assert.equal((await c.call('POST', '/api/meal-sessions/s1/finish', {})).status, 200);
  assert.equal((await c.call('POST', '/api/meal-sessions/none/finish', {})).status, 404);
  // 未确认全部食材时不能完成评估
  assert.equal((await c.call('PUT', `/api/meals/${id}/consumption`, { percentages: { 鸡蛋: 100 }, complete: true })).status, 400);
  assert.equal((await c.call('PUT', `/api/meals/${id}/consumption`, { percentages: { 鸡蛋: 100, 番茄: 50 }, complete: true })).status, 200);

  const doc = deps.store.getMeal(id);
  assert.equal(doc._openid, 'web:researcher');
  assert.equal(doc.source, 'web');
  assert.equal(doc.mealType, 'lunch');
  assert.deepEqual(doc.selectedRecords, {});
  assert.equal(doc.evaluationStatus, 'completed');
  assert.ok(doc.mealSessionFinishedAt > 0);
  assert.equal(doc.consumption.percentages.番茄, 50);
  assert.ok(doc.consumption.intake && doc.consumption.intake.algorithmVersion);
  assert.ok(doc.auditSnapshot && doc.auditSnapshot.ingredients.length === 2);
  assert.equal(doc.modelAudit.requestId, 'r1');
  assert.equal(doc.result.dish.ingredients.length, 2);
  // 已完成的评估不能被草稿改回待评
  assert.equal((await c.call('PUT', `/api/meals/${id}/consumption`, { percentages: {}, complete: false })).status, 409);

  const history = (await c.call('GET', '/api/meals?view=history')).data;
  assert.ok(history.some((m) => m.analysisId === id));
  const day = doc.createdAt - (doc.createdAt % 86400000);
  const range = (await c.call('GET', `/api/meals/range?participantCode=001207&start=${day - 86400000}&end=${day + 2 * 86400000}`)).data;
  assert.deepEqual(range.map((m) => m.analysisId), [id]);
});

test('参与者只能读写本人编号；重新发码后旧设备退出', async () => {
  const r = await researcher();
  const { id } = await completedMeal(r, '001208', 's2');
  const p = await participant('001208');
  assert.deepEqual((await p.call('GET', '/api/session')).data, { role: 'participant', participantCode: '001208', label: '参与者 001208' });
  assert.equal((await p.call('GET', `/api/meals/${id}`)).status, 200);
  const other = await participant('009999');
  assert.equal((await other.call('GET', `/api/meals/${id}`)).status, 404);
  assert.equal((await other.call('GET', `/api/meals/${id}/status`)).status, 404);
  assert.equal((await other.call('DELETE', `/api/meals/${id}`)).status, 404);
  assert.equal((await other.call('GET', `/api/meals/range?participantCode=001208&start=0&end=86400000`)).status, 403);
  assert.equal((await other.call('GET', deps.store.getMeal(id).imageUrl)).status, 404);
  const img = await other.call('POST', '/api/images', JPEG);
  assert.equal((await other.call('POST', '/api/meals', { imageFileId: img.data.fileId, plateDiameterCm: 26, participantCode: '001208' })).status, 403);
  assert.ok((await other.call('GET', '/api/meals?view=history')).data.every((m) => m.participantCode === '009999'));
  // 参与者自己拍的照片自己能看
  assert.equal((await other.call('GET', img.data.imageUrl)).status, 200);

  deps.auth.issueParticipantToken('001208');
  assert.equal((await p.call('GET', '/api/session')).status, 401);
  deps.auth.revokeParticipant('009999');
  assert.equal((await other.call('GET', '/api/session')).status, 401);
});

test('识别失败写回阶段与原因；作废与删除', async () => {
  const c = await researcher();
  visionImpl = async () => { throw new Error('千问接口返回 401（InvalidApiKey）'); };
  const failed = await completedMeal(c, '001207', 's3');
  assert.equal(failed.status.status, 'failed');
  assert.equal(failed.status.errorStage, '调用千问识别');
  assert.match(failed.status.errorMessage, /InvalidApiKey/);
  visionImpl = async () => ({ dish: JSON.parse(JSON.stringify(DISH)), modelName: 'qwen3.8-max-0902' });

  const ok = await completedMeal(c, '001207', 's4');
  assert.equal((await c.call('POST', `/api/meals/${ok.id}/discard`, {})).status, 200);
  assert.equal(deps.store.getMeal(ok.id).status, 'discarded');
  assert.equal((await c.call('PUT', `/api/meals/${ok.id}/excluded`, { names: ['鸡蛋'] })).status, 409);
  assert.equal((await c.call('DELETE', `/api/meals/${ok.id}`)).status, 200);
  assert.equal((await c.call('GET', `/api/meals/${ok.id}`)).status, 404);
  assert.equal(deps.images.get(ok.fileId), null);
});

test('二维码卡片模式：创建时不写盘径，识别后写入对照卡片量出的盘径', async () => {
  const c = await researcher();
  let received;
  let release;
  const gate = new Promise((r) => { release = r; });
  visionImpl = async (...args) => { received = args; await gate; return { dish: JSON.parse(JSON.stringify(DISH)), modelName: 'qwen3.8-max-0902',
    scaleEstimate: { mode: 'qr-card', referenceCardCm: 4, plateDiameterCm: 21.5, referenceCardVisible: true } }; };
  const img = await c.call('POST', '/api/images', JPEG);
  const created = await c.call('POST', '/api/meals', { imageFileId: img.data.fileId, scaleMode: 'qr-card', participantCode: '001207', mealSessionId: 'q1' });
  const before = deps.store.getMeal(created.data.analysisId);
  assert.equal(before.scaleMode, 'qr-card');
  assert.equal(before.plateDiameterCm, undefined);
  release();
  for (let i = 0; i < 50 && deps.store.getMeal(created.data.analysisId).status !== 'completed'; i += 1) await new Promise((r) => setTimeout(r, 10));
  const meal = (await c.call('GET', `/api/meals/${created.data.analysisId}`)).data;
  assert.deepEqual(received.slice(1), [0, { scale: { mode: 'qr-card', cardCm: 4 } }]);
  assert.equal(meal.plateDiameterCm, 21.5);
  assert.equal(meal.plateDiameterSource, 'qr-card');
  assert.equal(meal.scaleMode, 'qr-card');
  visionImpl = async () => ({ dish: JSON.parse(JSON.stringify(DISH)), modelName: 'qwen3.8-max-0902' });
});

test('服务重启：10 分钟内的未完成任务重新排队，更早的标记失败', async () => {
  const now = Date.now();
  deps.store.putMeal({ _id: 'a'.repeat(32), participantCode: 'x', status: 'recognizing', createdAt: now - 3600000, updatedAt: now, imageFileId: '' });
  const result = deps.queue.recover(now);
  assert.equal(result.failed, 1);
  assert.equal(deps.store.getMeal('a'.repeat(32)).errorStage, '服务重启');
  deps.store.deleteMeal('a'.repeat(32));
});

test('随访问卷：提交防重、冲突、分页、按编号隔离', async () => {
  const p = await participant('001300');
  const submission = { action: 'submit', submissionId: 'q_abc123def456ghi', questionnaireVersion: '2026-10-15-v1', participantCode: '001300', answers: ANSWERS };
  const first = (await p.call('POST', '/api/cloud/questionnaire', submission)).data;
  assert.equal(first.ok, true);
  assert.match(first.data.responseId, /^q_[a-f0-9]{30}$/);
  const again = (await p.call('POST', '/api/cloud/questionnaire', submission)).data;
  assert.equal(again.data.responseId, first.data.responseId);
  assert.equal(again.data.createdAt, first.data.createdAt);
  const conflict = (await p.call('POST', '/api/cloud/questionnaire', { ...submission, answers: { ...ANSWERS, q1: ['often'] } })).data;
  assert.equal(conflict.code, 'SUBMISSION_CONFLICT');
  const invalid = (await p.call('POST', '/api/cloud/questionnaire', { ...submission, submissionId: 'q_zzzzzzzzzzzzzz', answers: { q1: ['never'] } })).data;
  assert.equal(invalid.code, 'INVALID_INPUT');
  const forOther = (await p.call('POST', '/api/cloud/questionnaire', { ...submission, participantCode: '001301' })).data;
  assert.equal(forOther.code, 'FORBIDDEN');
  const list = (await p.call('POST', '/api/cloud/questionnaire', { action: 'list', participantCode: '001300' })).data;
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].answerItems.length, 6);
  const got = (await p.call('POST', '/api/cloud/questionnaire', { action: 'get', responseId: first.data.responseId })).data;
  assert.equal(got.ok, true);
  const stranger = await participant('001301');
  const denied = (await stranger.call('POST', '/api/cloud/questionnaire', { action: 'get', responseId: first.data.responseId })).data;
  assert.equal(denied.code, 'NOT_FOUND');
  const doc = deps.store.getQuestionnaire(first.data.responseId);
  assert.equal(doc._openid, 'web:participant:001300');
});

test('导出的 meal_records 可直接交给 scripts/export 生成 CSV', () => {
  const file = path.join(dir, 'meal_records.json');
  const meals = deps.store.allMeals();
  fs.writeFileSync(file, JSON.stringify(meals));
  assert.equal(parseRecords(fs.readFileSync(file, 'utf8')).length, meals.length);
  const out = path.join(dir, 'export-out');
  fs.mkdirSync(out);
  const { summary } = exportFile(file, {}, out);
  assert.ok(summary.exportedRecords >= 2, JSON.stringify(summary));
  assert.ok(fs.readFileSync(path.join(out, 'meals.csv'), 'utf8').includes('001207'));
});
