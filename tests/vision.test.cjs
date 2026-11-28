const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const vision = require('../cloudfunctions/analyzeMeal/vision');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);
const { resolveMeal } = require('../miniprogram/utils/texture.ts');
const { buildConsumption } = require('../miniprogram/utils/evaluation.ts');
const { meatCorrectionFactor } = require('../miniprogram/utils/weight.ts');
const { PROFILE, applyQuantityCalibration } = require('../cloudfunctions/analyzeMeal/quantityCalibration');
const { validateCalibration } = require('../scripts/vision/calibrate.cjs');
const clone = (v) => JSON.parse(JSON.stringify(v));
const dish = () => ({ dishName: '土豆炖牛肉', cookingMethod: '炖', recognitionConfidence: 'high', weightConfidence: 'medium',
  ingredients: [{ name: '牛肉', cookingMethod: '炖', areaRatio: .25, heightCm: 2, estimatedG: 200 },
    { name: '土豆', cookingMethod: '炖', areaRatio: .2, heightCm: 2, estimatedG: 150 }] });
const response = (d = dish()) => ({ model: vision.TARGET_MODEL, id: 'fixture-request', usage: { total_tokens: 100 },
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ dish: d }) } }] });

test('默认使用已完成代理校准的固定新模型，旧模型可显式回退', () => {
  const previous = process.env.QWEN_MODEL;
  try {
    delete process.env.QWEN_MODEL;
    assert.equal(vision.configuredModel(), vision.TARGET_MODEL);
    process.env.QWEN_MODEL = vision.LEGACY_MODEL;
    assert.equal(vision.configuredModel(), vision.LEGACY_MODEL);
    process.env.QWEN_MODEL = 'unverified-model';
    assert.throws(() => vision.configuredModel(), /固定快照/);
  } finally { if (previous === undefined) delete process.env.QWEN_MODEL; else process.env.QWEN_MODEL = previous; }
});

test('固定快照调用：JSON、有界推理、盘径提示、返回可追踪版本', async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'fixture-not-a-real-key';
  try {
    const result = await vision.callQwen('https://example.invalid/food.jpg', 24, { model: vision.TARGET_MODEL, postJson: async (url, body) => {
      assert.equal(new URL(url).hostname, 'dashscope.aliyuncs.com');
      assert.equal(body.model, 'qwen3.8-max-0902');
      assert.equal(body.enable_thinking, true);
      assert.equal(body.thinking_budget, 512);
      assert.deepEqual(body.response_format, { type: 'json_object' });
      assert.match(body.messages[1].content[1].text, /24 厘米/);
      return response();
    } });
    assert.equal(result.modelName, vision.TARGET_MODEL);
    assert.equal(result.promptVersion, 'qwen-dish-visible-food-weight-v8');
    assert.equal(result.requestId, 'fixture-request');
    assert.equal(result.dish.ingredients.length, 2);
    assert.equal(result.quantityCalibration.factor, 1.9);
    assert.equal(result.quantityCalibration.isWeighedCalibration, false);
    assert.equal(result.rawDish.ingredients[0].estimatedG, 200);
    assert.equal(result.dish.ingredients[0].estimatedG, 380);
  } finally { if (previous === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous; }
});

test('回退模型不发送新模型专用参数，不会静默换模型', async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'fixture-not-a-real-key';
  try {
    await vision.callQwen('https://example.invalid/food.jpg', 26, { model: vision.LEGACY_MODEL, postJson: async (_, body) => {
      assert.equal(body.model, 'qwen-vl-max');
      assert.equal(body.enable_thinking, undefined);
      assert.equal(body.response_format, undefined);
      return { ...response(), model: vision.LEGACY_MODEL };
    } });
    let calls = 0;
    await assert.rejects(vision.callQwen('https://example.invalid/food.jpg', 26, { model: vision.TARGET_MODEL, postJson: async () => { calls++; throw Error('unavailable'); } }), /unavailable/);
    assert.equal(calls, 1);
    await assert.rejects(vision.callQwen('', 26, { model: 'unverified-model' }), /不支持/);
  } finally { if (previous === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous; }
});

test('截断、拒绝和空响应不得写成识别成功', async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'fixture-not-a-real-key';
  try {
    for (const finish of ['length', 'content_filter', undefined]) {
      const r = response(); r.choices[0].finish_reason = finish;
      await assert.rejects(vision.callQwen('', 26, { model: vision.TARGET_MODEL, postJson: async () => r }), /未完整/);
    }
  } finally { if (previous === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous; }
});

test('无食物是合法空结果，缺失结构、空食材不是', () => {
  assert.equal(vision.parseDish('{"dish":null}'), null);
  assert.throws(() => vision.parseDish('{}'), /菜名/);
  assert.throws(() => vision.parseDish(JSON.stringify({ dish: { ...dish(), ingredients: [] } })), /数量/);
  assert.deepEqual(vision.parseDish('```json\n' + JSON.stringify({ dishes: [dish()] }) + '\n```'), vision.normalizeDish(dish()));
});

test('真实接口出现的字段空格可无损修复，冲突字段必须拒绝', () => {
  const d = dish(); const i = d.ingredients[0];
  i['a reaRatio'] = i.areaRatio; delete i.areaRatio;
  const repairs = [];
  assert.equal(vision.parseDish(JSON.stringify({ dish: d }), { repairs }).ingredients[0].areaRatio, .25);
  assert.deepEqual(repairs, ['normalized_field_whitespace']);
  i.areaRatio = .8;
  assert.throws(() => vision.parseDish(JSON.stringify({ dish: d })), /冲突/);
  assert.throws(() => vision.parseDish('null'), /根节点/);
});

test('格式错误只在同一模型修复一次，成功记录重试次数', async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'fixture-not-a-real-key';
  let calls = 0;
  try {
    const r = await vision.callQwen('', 26, { model: vision.TARGET_MODEL, postJson: async (_, body, headers, remaining) => {
      assert.equal(body.model, vision.TARGET_MODEL);
      assert.ok(remaining > 0 && remaining <= 50000);
      calls++;
      return calls === 1 ? response({ ...dish(), ingredients: [] }) : response();
    } });
    assert.equal(calls, 2); assert.equal(r.attempts, 2);
  } finally { if (previous === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous; }
});

test('空结果最多复核一次，确认无食物时仍保持 null 而不伪造食材', async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'fixture-not-a-real-key';
  let calls = 0;
  try {
    const r = await vision.callQwen('', 26, { model: vision.TARGET_MODEL, postJson: async () => { calls++; return response(null); } });
    assert.equal(calls, 2); assert.equal(r.dish, null); assert.equal(r.attempts, 2);
  } finally { if (previous === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous; }
});

test('异常几何量、重复食材与非数值被阻断，兼容数字百分数', () => {
  for (const [key, value] of [['heightCm', 20], ['estimatedG', 4000], ['areaRatio', -1], ['areaRatio', '35%'], ['heightCm', null]]) {
    const d = dish(); d.ingredients[0][key] = value;
    assert.throws(() => vision.parseDish(JSON.stringify({ dish: d })));
  }
  const duplicate = dish(); duplicate.ingredients.push(duplicate.ingredients[0]);
  assert.throws(() => vision.parseDish(JSON.stringify({ dish: duplicate })), /重复/);
  const d = dish(); d.ingredients[0].areaRatio = 25;
  assert.equal(vision.parseDish(JSON.stringify({ dish: d })).ingredients[0].areaRatio, .25);
  d.ingredients[0].areaRatio = .9;
  assert.throws(() => vision.validateDish(vision.parseDish(JSON.stringify({ dish: d }))), /100%/);
});

test('新模型输出沿用原肉类减半、配菜不减半与食用比例', () => {
  const d = vision.parseDish(JSON.stringify({ dish: dish() }));
  const resolved = resolveMeal(d, {}, 26);
  assert.equal(meatCorrectionFactor('牛肉'), .5);
  for (const name of ['土豆', '鱼肉', '鸡蛋', '素肉', '鸡腿菇']) assert.equal(meatCorrectionFactor(name), 1);
  assert.equal(resolved.ingredients.length, 2);
  assert.match(resolved.ingredients[0].weightBasis, /乘 0.5/);
  assert.doesNotMatch(resolved.ingredients[1].weightBasis, /乘 0.5/);
  assert.ok(resolved.ingredients.every(i => i.recordId && i.readings.length));
  const meal = { analysisId: 'fixture', dish: d, plateDiameterCm: 26 };
  const c = buildConsumption(meal, { 牛肉: 500, 土豆: 0 }, true);
  assert.equal(c.consumedGrams.牛肉, resolved.ingredients[0].grams * 5);
  assert.equal(c.consumedGrams.土豆, 0);
  assert.equal(resolveMeal(d, {}, 26, ['牛肉']).totalG, resolved.ingredients[1].grams);
});

test('五香酱牛肉保留切割和下压双读数，用户改选记录优先', () => {
  const d = { dishName: '五香酱牛肉', cookingMethod: '卤', recognitionConfidence: 'high', weightConfidence: 'medium',
    ingredients: [{ name: '牛腱子肉', cookingMethod: '卤', areaRatio: .3, heightCm: 2, estimatedG: 150 }] };
  const result = resolveMeal(vision.parseDish(JSON.stringify({ dish: d })), { 牛腱子肉: 't26' }, 26);
  assert.equal(result.ingredients[0].recordId, 't26');
  assert.deepEqual(result.ingredients[0].readings.map(r => r.testMode), ['切割测试', '下压测试']);
});

test('份量校准保留原始预测，肉类减半只执行一次，质构记录不变', () => {
  const d = vision.normalizeDish(dish()); const before = clone(d);
  const raw = resolveMeal(d, {}, 26);
  const corrected = resolveMeal(applyQuantityCalibration(d), {}, 26);
  assert.deepEqual(d, before);
  for (let i = 0; i < raw.ingredients.length; i++) {
    assert.ok(Math.abs(corrected.ingredients[i].grams - raw.ingredients[i].grams * PROFILE.factor) <= 5);
    assert.equal(corrected.ingredients[i].recordId, raw.ingredients[i].recordId);
  }
  assert.equal((corrected.ingredients[0].weightBasis.match(/乘 0.5/g) || []).length, 1);
  assert.doesNotMatch(corrected.ingredients[1].weightBasis, /乘 0.5/);
});

test('校准体积保持面积与厚度范围，超出接口容量时拒绝而不偷偷截小', () => {
  const d = vision.normalizeDish(dish());
  d.ingredients.forEach(i => { i.areaRatio = .45; i.heightCm = 4; });
  const c = applyQuantityCalibration(d, 2);
  assert.ok(c.ingredients.reduce((s,i) => s+i.areaRatio, 0) <= 1);
  c.ingredients.forEach((i,index) => {
    assert.ok(i.heightCm <= 8 && i.areaRatio <= 1);
    assert.ok(Math.abs(i.areaRatio * i.heightCm - d.ingredients[index].areaRatio * d.ingredients[index].heightCm * 2) < 1e-9);
  });
  const crowded = clone(d);
  Object.assign(crowded.ingredients[0], { areaRatio:.65, heightCm:6 });
  Object.assign(crowded.ingredients[1], { areaRatio:.1, heightCm:.5 });
  const redistributed = applyQuantityCalibration(crowded, 2);
  assert.ok(redistributed.ingredients.reduce((s,i)=>s+i.areaRatio,0) <= 1+1e-12);
  redistributed.ingredients.forEach((i,index) => {
    assert.ok(i.heightCm <= 8+1e-12);
    assert.ok(Math.abs(i.areaRatio*i.heightCm-crowded.ingredients[index].areaRatio*crowded.ingredients[index].heightCm*2)<1e-9);
  });
  d.ingredients.forEach(i => { i.heightCm = 8; });
  assert.throws(() => applyQuantityCalibration(d, 2), /超出/);
});

test('留组验证的校准系数不使用被验证组的旧版参照值', () => {
  const base = vision.normalizeDish(dish());
  const mass = resolveMeal(base, {}, 26).totalG;
  const predictions = [1,2,3].map(sample => ({sample,dish:clone(base)}));
  const refs = [1.5,2,2.5].map((scale,index)=>({sample:index+1,totalG:mass*scale,newTotalG:mass,plateDiameterCm:26}));
  const a=validateCalibration(refs,predictions,[[1],[2],[3]]);
  refs[2].totalG=mass*3;
  const b=validateCalibration(refs,predictions,[[1],[2],[3]]);
  assert.equal(a.rows[2].heldOutFactor,b.rows[2].heldOutFactor);
  const archived=predictions.map(p=>({...p,rawDish:p.dish,dish:applyQuantityCalibration(p.dish),quantityCalibration:PROFILE}));
  assert.deepEqual(validateCalibration(refs,archived,[[1],[2],[3]]).rows,b.rows);
});

function loadCloud(record, invoke = async () => ({ dish: vision.normalizeDish(dish()), modelName: vision.TARGET_MODEL, promptVersion: vision.PROMPT_VERSION })) {
  let calls = 0;
  const doc = { async get() { return { data: clone(record) }; }, async update({ data }) { Object.assign(record, clone(data)); } };
  const db = { command: { set: v => v }, collection: () => ({ doc: () => doc, add: async ({ data }) => { Object.assign(record, data); return { _id: 'new' }; } }) };
  const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'fixture' }), getTempFileURL: async () => ({ fileList: [{ tempFileURL: 'https://example.invalid/test.jpg' }] }) };
  const sandbox = { exports: {}, process: { env: {} }, console: { error() {} }, require: (name) => {
    if (name === 'wx-server-sdk') return cloud;
    if (name === './vision') return { ...vision, configuredModel: () => vision.TARGET_MODEL, callQwen: async (...args) => { calls++; return invoke(...args); } };
    throw Error(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../cloudfunctions/analyzeMeal/index.js'), 'utf8'), sandbox);
  return { main: sandbox.exports.main, calls: () => calls };
}

test('完成和作废的旧记录不被新模型重新计算', async () => {
  for (const status of ['completed', 'discarded']) {
    const record = { status, modelName: vision.LEGACY_MODEL, result: { dish: dish() }, selectedRecords: { 牛肉: 'old-id' }, consumption: { totalConsumedG: 123 } };
    const before = clone(record); const fn = loadCloud(record);
    await fn.main({ action: 'process', analysisId: 'old' });
    assert.deepEqual(record, before); assert.equal(fn.calls(), 0);
  }
});

test('跨部署任务写入实际执行模型，保留参与者和会话信息', async () => {
  const record = { status: 'pending', modelName: vision.LEGACY_MODEL, imageFileId: 'cloud://fixture', participantCode: '001', mealSessionId: 'meal-1' };
  const fn = loadCloud(record); await fn.main({ action: 'process', analysisId: 'new' });
  assert.equal(record.status, 'completed'); assert.equal(record.modelName, vision.TARGET_MODEL);
  assert.equal(record.participantCode, '001'); assert.equal(record.mealSessionId, 'meal-1');
  assert.equal(record.modelAudit.modelName, vision.TARGET_MODEL);
});

test('识别失败保留原结果，识别途中作废不会被失败或成功覆盖', async () => {
  const record = { status: 'pending', imageFileId: 'cloud://fixture', result: { dish: null } };
  const fn = loadCloud(record, async () => { throw Error('模型输出未完整结束'); });
  await fn.main({ action: 'process', analysisId: 'new' });
  assert.equal(record.status, 'failed'); assert.deepEqual(record.result, { dish: null });
  for (const fails of [true, false]) {
    const r = { status: 'pending', imageFileId: 'cloud://fixture' };
    const f = loadCloud(r, async () => { r.status = 'discarded'; if (fails) throw Error('timeout'); return { dish: dish(), modelName: vision.TARGET_MODEL }; });
    await f.main({ action: 'process', analysisId: 'new' });
    assert.equal(r.status, 'discarded'); assert.equal(r['result.dish'], undefined);
  }
});

test('二维码卡片模式：提示词以 4 cm 卡片为尺度、不含固定盘径，返回模型量出的盘径', async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  process.env.DASHSCOPE_API_KEY = 'fixture-not-a-real-key';
  try {
    const qrDish = { ...dish(), plateDiameterCm: 23.46, referenceCardVisible: true };
    const result = await vision.callQwen('https://example.invalid/food.jpg', 0, { model: vision.TARGET_MODEL, scale: { mode: 'qr-card', cardCm: 4 },
      postJson: async (url, body) => {
        const text = body.messages[1].content[1].text;
        assert.match(text, /边长 4 厘米的正方形二维码卡片/);
        assert.match(text, /plateDiameterCm/);
        assert.doesNotMatch(text, /实际直径是 \d+ 厘米/);
        assert.match(text, /不要列入食材/);
        return { ...response(), choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ dish: qrDish }) } }] };
      } });
    assert.equal(result.promptVersion, vision.QR_PROMPT_VERSION);
    assert.deepEqual(result.scaleEstimate, { mode: 'qr-card', referenceCardCm: 4, plateDiameterCm: 23.5, referenceCardVisible: true });
    assert.equal(result.dish.plateDiameterCm, undefined, '盘径不混进菜品结构');
    // 份量校准照旧
    assert.equal(result.dish.ingredients[0].estimatedG, 380);
  } finally { if (previous === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previous; }
});

test('二维码卡片模式：缺盘径或超范围算输出无效；回退模型不支持该模式', async () => {
  assert.throws(() => vision.parseResponse(JSON.stringify({ dish: dish() }), { cardCm: 4 }), /餐盘口径/);
  assert.throws(() => vision.parseResponse(JSON.stringify({ dish: { ...dish(), plateDiameterCm: 300 } }), { cardCm: 4 }), /餐盘口径/);
  const noCard = vision.parseResponse(JSON.stringify({ dish: { ...dish(), plateDiameterCm: 26, referenceCardVisible: false } }), { cardCm: 4 });
  assert.equal(noCard.scale.referenceCardVisible, false);
  assert.equal(vision.parseResponse('{"dish":null}', { cardCm: 4 }).scale, null);
  await assert.rejects(vision.callQwen('', 0, { model: vision.LEGACY_MODEL, scale: { mode: 'qr-card' } }), /只支持固定快照/);
  // 选餐盘直径时提示词与 v8 逐字相同
  assert.equal(vision.userPrompt(24).includes('实际直径是 24 厘米'), true);
});

test('云函数：二维码卡片记录先不写盘径，识别后写入量出的盘径与来源；旧版前端仍走餐盘直径', async () => {
  const created = {};
  await loadCloud(created).main({ action: 'create', imageFileId: 'cloud://x', scaleMode: 'qr-card', participantCode: '001' });
  assert.equal(created.scaleMode, 'qr-card');
  assert.equal(created.referenceCardCm, 4);
  assert.equal(created.plateDiameterCm, undefined);
  assert.equal(created.promptVersion, vision.QR_PROMPT_VERSION);
  const legacy = {};
  await loadCloud(legacy).main({ action: 'create', imageFileId: 'cloud://x', plateDiameterCm: 24 });
  assert.equal(legacy.scaleMode, 'plate');
  assert.equal(legacy.plateDiameterCm, 24);
  assert.equal(legacy.plateDiameterSource, 'user');
  assert.equal(legacy.promptVersion, vision.PROMPT_VERSION);

  for (const visible of [true, false]) {
    const record = { status: 'pending', imageFileId: 'cloud://fixture', scaleMode: 'qr-card', referenceCardCm: 4 };
    let args;
    const fn = loadCloud(record, async (...a) => { args = a; return { dish: vision.normalizeDish(dish()), modelName: vision.TARGET_MODEL,
      promptVersion: vision.QR_PROMPT_VERSION, scaleEstimate: { mode: 'qr-card', referenceCardCm: 4, plateDiameterCm: 22.5, referenceCardVisible: visible } }; });
    await fn.main({ action: 'process', analysisId: 'qr' });
    assert.deepEqual(clone(args[2]), { scale: { mode: 'qr-card', cardCm: 4 } });
    assert.equal(record.status, 'completed');
    assert.equal(record.plateDiameterCm, 22.5);
    assert.equal(record.plateDiameterSource, visible ? 'qr-card' : 'model-guess');
  }
  const plate = { status: 'pending', imageFileId: 'cloud://fixture', plateDiameterCm: 24 };
  let plateArgs;
  await loadCloud(plate, async (...a) => { plateArgs = a; return { dish: vision.normalizeDish(dish()), modelName: vision.TARGET_MODEL }; }).main({ action: 'process', analysisId: 'p' });
  assert.equal(plateArgs.length, 2);
  assert.equal(plate.plateDiameterCm, 24);
  assert.equal(plate.plateDiameterSource, undefined);
});
