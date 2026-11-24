// 模型接入与输出契约；无数据库读写，可独立执行真实接口回归。
const https = require('https');
const { PROFILE: CALIBRATION_PROFILE, applyQuantityCalibration } = require('./quantityCalibration');
const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
// 固定官方 2026-09-02 快照，防止滚动别名改变研究数据口径。
const TARGET_MODEL = 'qwen3.8-max-0902';
const LEGACY_MODEL = 'qwen-vl-max';
const LEGACY_PROMPT_VERSION = 'qwen-dish-ingredients-weight-v5';
const PROMPT_VERSION = 'qwen-dish-visible-food-weight-v8';
const ADAPTER_VERSION = '2026-09-28-vision-proxy-calibration-v1';
function configuredModel() {
  // 按用户认可的旧算法快照完成代理校准；版本与系数在 quantityCalibration.js 固定。
  const model = process.env.QWEN_MODEL || TARGET_MODEL;
  if (![TARGET_MODEL, LEGACY_MODEL].includes(model)) throw new Error('QWEN_MODEL 必须使用支持的固定快照或 qwen-vl-max 回退版本');
  return model;
}
// ---- 千问调用与解析 ----------------------------------------------------------
async function callQwen(imageUrl, plateDiameterCm, options = {}) {
  const model = options.model || configuredModel();
  if (![TARGET_MODEL, LEGACY_MODEL].includes(model)) throw new Error('不支持的模型版本');
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY 环境变量');

  const body = {
    model,
    ...(model === TARGET_MODEL ? { enable_thinking: true, thinking_budget: 512, temperature: 0, response_format: { type: 'json_object' }, max_tokens: 4096 } : {}),
    messages: [
      { role: 'system', content: model === LEGACY_MODEL ? LEGACY_SYSTEM_PROMPT : SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: model === LEGACY_MODEL ? legacyUserPrompt(plateDiameterCm) : userPrompt(plateDiameterCm) },
        ],
      },
    ],
  };

  const startedAt = Date.now();
  // 同一个模型最多修复一次格式错误，整个识别仍受 50 秒总预算约束。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remainingMs = 50000 - (Date.now() - startedAt);
    if (remainingMs <= 0) throw new Error('调用千问接口超过 50s 总时限');
    let outputInvalid = false;
    try {
      const data = await (options.postJson || postJson)(DASHSCOPE_URL, body, {
        Authorization: `Bearer ${apiKey}`,
      }, remainingMs);
      const choice = data && data.choices && data.choices[0];
      if (!choice || choice.finish_reason !== 'stop') {
        outputInvalid = !!choice && choice.finish_reason === 'length';
        throw new Error('模型输出未完整结束，拒绝保存不完整结果');
      }
      const repairs = [];
      let dish;
      try {
        dish = parseDish(choice.message && choice.message.content, { strict: model !== LEGACY_MODEL, repairs });
        if (model !== LEGACY_MODEL) validateDish(dish);
      } catch (error) { outputInvalid = true; throw error; }
      if (dish === null && model === TARGET_MODEL && attempt === 0 && Date.now() - startedAt < 40000) {
        body.messages.push({ role: 'user', content: '请再检查餐盘中央：无法判断食物的具体品种不等于没有食物。若能看出是肉但分不清种类，可写肉块（种类不明）并给 low 置信度；如果确实没有可见食物，仍返回 dish:null。不要为了返回结果而编造食物。' });
        continue;
      }
      const rawDish = dish;
      const calibrated = model === TARGET_MODEL && options.calibrate !== false;
      if (calibrated) dish = applyQuantityCalibration(rawDish);
      return { dish, modelName: model, resolvedModel: data.model || model,
        promptVersion: model === LEGACY_MODEL ? LEGACY_PROMPT_VERSION : PROMPT_VERSION, adapterVersion: ADAPTER_VERSION,
        elapsedMs: Date.now() - startedAt, requestId: data.id || '', usage: data.usage || null,
        attempts: attempt + 1, outputRepairs: repairs,
        inferenceConfig: model === TARGET_MODEL ? { thinking: true, thinkingBudget: 512, temperature: 0 } : { legacyDefaults: true },
        ...(calibrated ? { rawDish, quantityCalibration: { ...CALIBRATION_PROFILE, geometry: 'effective-volume-for-legacy-frontend' } } : {}) };
    } catch (error) {
      const transient = error.status === 429 || error.status >= 500;
      if (model !== TARGET_MODEL || attempt > 0 || (!outputInvalid && !transient) || Date.now() - startedAt >= 40000) throw error;
      if (outputInvalid) body.messages.push({ role: 'user', content: '请重新看图并严格检查 JSON：字段名不要插入空格；份量必须是正数；各食材只按露出面积估计，面积比例相加不能超过 1。无法辨认的配料不要列入。' });
    }
  }

}

/**
 * 用 Node 内置 https 发一个 JSON POST 并把响应解析成对象。
 * 这是 axios 在本函数里唯一被用到的能力，自己写十几行就够，省掉一个第三方依赖。
 */
function postJson(url, body, headers, timeoutMs = 50000) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const target = new URL(url);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            // 必须按字节数算，中文 prompt 的字符数 ≠ 字节数，写错会被服务端判为请求体截断。
            'Content-Length': payload.length,
          },
          headers,
        ),
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let code = 'UnknownError';
            try { const e = JSON.parse(text); code = String((e.error && e.error.code) || e.code || code).replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80); } catch (_) {}
            const error = new Error(`千问接口返回 ${res.statusCode}（${code}）`);
            error.status = res.statusCode;
            error.code = code;
            reject(error);
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error('千问响应不是合法 JSON'));
          }
        });
      },
    );
    // 云函数超时设为 60s，这里留 50s，好让错误由我们自己抛出而不是被平台直接掐断。
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('调用千问接口超时（50s）'));
    });
    const deadline = setTimeout(() => req.destroy(new Error('调用千问接口超过 50s 总时限')), timeoutMs);
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const LEGACY_SYSTEM_PROMPT =
  '你是专业的中餐菜品识别助手，同时擅长看图估计食物的份量。' +
  '根据照片说出【一道】菜的菜名、整道菜的烹饪方式、这道菜里**所有**可分辨的食材，' +
  '以及每种食材的份量几何量。' +
  '下游会拿每一种食材单独去查实测质构数据，因此食材要尽量列全、不要合并成一个笼统的名字。' +
  '只输出 JSON，不要任何解释文字或 markdown 代码块。';

const SYSTEM_PROMPT = LEGACY_SYSTEM_PROMPT +
  '只依据照片中可见的食物，不要依据菜谱猜测隐藏原料。' +
  '馒头、花卷等成型主食按成品识别和估重，不拆成面粉、面团、酵母或水。' +
  '每一项必须对应可单独辨认并估计份量的食物，避免整体与原料重复计重。';

/**
 * 用户提示词。餐盘直径是整张图里唯一已知的真实长度，必须写进 prompt——
 * 没有它，模型对「几克」只能瞎猜（同一盘菜拍近拍远像素面积能差几倍）。
 * 我们要的是模型**看图量尺寸**（占了盘子多大一片、堆了多厚），
 * 克数由小程序端按体积 × 堆积密度自己算（见 miniprogram/utils/weight.ts）。
 */
function legacyUserPrompt(plateDiameterCm) {
  return [
    `照片里这个餐盘的实际直径是 ${plateDiameterCm} 厘米，请以它作为唯一的尺寸基准。`,
    '识别照片里最主要的那一道菜（只出一道），把这道菜里的食材列全，并估计每种食材的份量。',
    '严格按以下 JSON 结构输出（字段名与类型完全一致）：',
    '{"dish":{"dishName":"string","cookingMethod":"string",' +
      '"recognitionConfidence":"high|medium|low","weightConfidence":"high|medium|low",' +
      '"ingredients":[{"name":"string","cookingMethod":"string",' +
      '"areaRatio":number,"heightCm":number,"estimatedG":number}]}}',
    '约束：',
    '- 图里出现多样菜时，只输出占比最大、最像「主菜」的那一道，不要输出多道；',
    '- dishName 用最常见的中文标准菜名（如 大煮干丝 / 清蒸石斑鱼 / 红烧肉），不要加形容词或份量；',
    '- cookingMethod 用单个简短中文词：煮/炖/蒸/炒/炸/煎/烤/焖/烧/卤/凉拌/白灼/爆炒/红烧/清蒸 等；',
    '- ingredients 要列出这道菜里**每一种**看得见或按这道菜的常规做法必然含有的食材，' +
      '通常 2–6 种，最多 10 种；宁可多列一种，也不要漏掉主料或配菜；',
    '- name 用食材本名并保留刀工形态，如 豆腐丝 / 火腿丝 / 带皮五花肉 / 土豆丝 / 白菜帮；' +
      '不要用「蔬菜」「肉」这种笼统词，也不要写成「土豆和青椒」这种复合名——一种食材一个条目；',
    '- 葱、姜、蒜、香菜、干辣椒、花椒等只起调味作用的配料不要列入；',
    '- 每种食材的 cookingMethod 写它在这道菜里的受热方式；',
    '',
    '份量三个字段怎么估（这部分很重要，请认真看图测量）：',
    `- areaRatio：该食材在**盘面**上占据的面积比例，0–1 的小数。以直径 ${plateDiameterCm}cm 的盘面为分母，` +
      '不是以整张照片为分母。所有食材的 areaRatio 相加应当接近盘中食物的总覆盖率，一般在 0.3–0.9 之间，' +
      '绝不应超过 1；食材互相堆叠遮挡时，按它**露出来的**面积算；',
    '- heightCm：该食材在盘上的平均堆叠厚度，单位厘米。可参照常识：一片肉约 0.5–1cm，' +
      '一层青菜堆起来约 1–3cm，一块红烧肉约 2–3cm，整条鱼约 3–5cm，汤汁约 0.5–1cm；',
    '- estimatedG：你直接凭经验估的克数（整数）。这个值只作交叉校验，' +
      '所以请**独立**给出，不要用 areaRatio 和 heightCm 反推；',
    '- weightConfidence 是你对整体份量估计的信心；俯拍清晰、餐盘完整入镜给 high，' +
      '斜拍、遮挡多、看不清厚度给 low；',
    '- recognitionConfidence 只能取 "high"/"medium"/"low"；',
    '- 若图中没有可识别的食物，输出 {"dish":null}。',
  ].join('\n');
}

function userPrompt(plateDiameterCm) {
  return legacyUserPrompt(plateDiameterCm)
    .replace('- ingredients 要列出这道菜里**每一种**看得见或按这道菜的常规做法必然含有的食材，通常 2–6 种，最多 10 种；宁可多列一种，也不要漏掉主料或配菜；',
      '- ingredients 仅列照片中可分辨的食物，允许只有 1 项，最多 10 项。看不清的肉类、菌菇、花生等不得按菜谱补出；不确定时降低 recognitionConfidence；') + '\n' + [
      '- 馒头、花卷、包子、面包、饼干、米饭、面条等成型主食保留成品名称，例如 馒头 / 花卷 / 米饭，不拆成面粉、面团、酵母、水、生米或鸡蛋液。',
      '- 混合菜中可分辨的熟鸡蛋、韭菜、肉丝等仍分开；鸡蛋部分写 鸡蛋，不要同时列整道鸡蛋饼和其组成。不能确定含有面粉时，不要添加面粉糊。',
      '- 食材名称用常用本名并保留有意义的刀工，鸡蛋写 鸡蛋，不写 带壳鸡蛋 或 鸡蛋液；玉米写 玉米，不写 甜玉米棒。不要加新鲜、优质等修饰词。',
      '- 葱姜蒜等纯调味料不单独估重，不把照片边缘的其他餐具或背景食物计入主菜。',
      '- 每项必须有可用的份量数据：0 < areaRatio <= 1，0 < heightCm <= 8，estimatedG > 0；整份食物只计算一次。',
      '- 餐盘中可能只有很少的食物，不要按常规一盘菜的份量估计；请仔细比较食物与餐盘的实际比例。',
      '- dish:null 仅用于照片确实没有可见食物。看得出有食物但品种不明时，返回能确认的最低限度名称，如 肉块（种类不明），recognitionConfidence 和 weightConfidence 均给 low；不要猜成某种具体肉。',
      '- 直接估重按照片中实际份量给出，不做肉类减半或其他事后校正；后续校正由程序统一完成。',
    ].join('\n');
}

function parseDish(content, { strict = true, repairs = [] } = {}) {
  if (!content) throw new Error('千问返回空内容');
  const json = repairFieldNames(extractJson(content), repairs);
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('模型返回的根节点不是对象');
  // 兼容模型仍按数组返回的情况：取第一道。
  const raw = json.dish || (Array.isArray(json.dishes) ? json.dishes[0] : null);
  if (Object.prototype.hasOwnProperty.call(json, 'dish') && json.dish === null) return null;
  if (!raw || typeof raw.dishName !== 'string' || !raw.dishName.trim()) {
    if (!strict) return null;
    throw new Error('模型缺少有效菜名');
  }
  if (strict) validateRawDish(raw);
  return normalizeDish(raw);
}

// 只修复已知字段中无意义的空白；不猜测新字段，不改数值，冲突时拒绝。
function repairFieldNames(value, repairs) {
  if (Array.isArray(value)) return value.map(v => repairFieldNames(v, repairs));
  if (!value || typeof value !== 'object') return value;
  const known = ['dish', 'dishes', 'dishName', 'cookingMethod', 'recognitionConfidence', 'weightConfidence', 'ingredients', 'name', 'areaRatio', 'heightCm', 'estimatedG'];
  const result = Object.create(null);
  for (const key of Object.keys(value)) {
    const compact = key.replace(/\s/g, '');
    const canonical = known.includes(compact) ? compact : key;
    if (Object.prototype.hasOwnProperty.call(result, canonical)) throw new Error('模型返回重复或冲突字段');
    if (canonical !== key && !repairs.includes('normalized_field_whitespace')) repairs.push('normalized_field_whitespace');
    result[canonical] = repairFieldNames(value[key], repairs);
  }
  return result;
}

function extractJson(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('无法解析千问返回的 JSON');
  }
}

const LEVELS = ['high', 'medium', 'low'];
function level(v) {
  return LEVELS.indexOf(v) >= 0 ? v : 'medium';
}

/** 数值兜底：非法值归零，并夹到 [lo, hi] */
function num(v, lo, hi) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.min(hi, Math.max(lo, n));
}

/** areaRatio 归一到 0–1。模型有时会写成百分数（35 表示 35%），这里顺手换算回来 */
function ratio(v) {
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return 0;
  if (n > 1 && n <= 100) return n / 100;
  return Math.min(1, n);
}

function normalizeDish(d) {
  const dishName = String((d && d.dishName) || '未知菜品').trim();
  const cookingMethod = String((d && d.cookingMethod) || '').trim();
  const weightConfidence = level(d && d.weightConfidence);
  const rawIngredients = Array.isArray(d && d.ingredients) ? d.ingredients : [];
  const seen = Object.create(null);
  const ingredients = rawIngredients
    .map((ing) => ({
      name: String((ing && ing.name) || '').trim(),
      cookingMethod: String((ing && ing.cookingMethod) || cookingMethod).trim(),
      // 几何量在这里就夹到合理区间：模型偶尔会把 areaRatio 写成百分数（如 35），
      // 或给出离谱的厚度，放任它传下去会让估重差一个量级。
      areaRatio: ratio(ing && ing.areaRatio),
      heightCm: num(ing && ing.heightCm, 0, 20),
      estimatedG: num(ing && ing.estimatedG, 0, 3000),
      weightConfidence: weightConfidence,
    }))
    .filter((ing) => {
      // 模型偶尔会把同一种食材列两遍；这里去重，避免前端出现两张一模一样的卡片。
      if (!ing.name || seen[ing.name]) return false;
      seen[ing.name] = true;
      return true;
    })
    // 与前端 MAX_QUERY_INGREDIENTS 对齐，防止极端情况下列出几十种配料。
    .slice(0, 10);
  return {
    dishName,
    cookingMethod,
    recognitionConfidence: level(d && d.recognitionConfidence),
    weightConfidence,
    // 模型没拆出食材时，用菜名本身兜底，保证前端至少能做一次食材匹配。
    ingredients: ingredients.length ? ingredients : [{ name: dishName, cookingMethod }],
  };
}

// 有菜品时，几何量缺失或量级异常不能静默降级成看似成功的零克数。
function validateRawDish(d) {
  if (typeof d.cookingMethod !== 'string' || !d.cookingMethod.trim() ||
      !LEVELS.includes(d.recognitionConfidence) || !LEVELS.includes(d.weightConfidence)) {
    throw new Error('模型缺少有效烹饪方式或置信度');
  }
  if (!Array.isArray(d.ingredients) || d.ingredients.length < 1 || d.ingredients.length > 10) throw new Error('模型食材数量不符合 1–10 条约定');
  const seen = new Set();
  for (const i of d.ingredients) {
    if (!i || typeof i.name !== 'string' || !i.name.trim() || seen.has(i.name.trim())) throw new Error('模型食材名称缺失或重复');
    seen.add(i.name.trim());
    for (const key of ['areaRatio', 'heightCm', 'estimatedG']) {
      if (typeof i[key] !== 'number' || !Number.isFinite(i[key]) || i[key] <= 0) throw new Error(`模型 ${key} 缺失或非法`);
    }
    if (i.areaRatio > 100 || i.heightCm > 8 || i.estimatedG > 3000) throw new Error('模型份量超出可验证范围');
  }
}
function validateDish(dish) {
  if (!dish) return;
  const area = dish.ingredients.reduce((sum, i) => sum + i.areaRatio, 0);
  if (area > 1.01) throw new Error('食材盘面占比合计超过 100%，请重新识别');
}
module.exports = { TARGET_MODEL, LEGACY_MODEL, PROMPT_VERSION, LEGACY_PROMPT_VERSION, ADAPTER_VERSION,
  configuredModel, callQwen, postJson, parseDish, normalizeDish, validateDish,
  SYSTEM_PROMPT, userPrompt, LEGACY_SYSTEM_PROMPT, legacyUserPrompt };
