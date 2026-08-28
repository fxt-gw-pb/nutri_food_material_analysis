// 云函数 analyzeMeal —— 菜品识别（千问 Qwen-VL），单段异步。
//
// 本版本只做「看图说出这道菜的菜名 + 烹饪方式 + 全部食材」，不估算任何重量。
// 一次识别只出一道菜——图里有多样菜时挑最主要的那一道——但要把这道菜里
// **能分辨的每一种食材都列全**，因为小程序是逐食材去质构库里取数据的：
// 少列一种食材，用户就少看到一条实测数据。
// 质构数据的匹配全部在小程序端用内置数据库完成（miniprogram/services/textureMatch.ts）。
//
// 两个 action（由前端分两次调用，见 mealService.cloud.ts）：
//   action='create'  : 写入 pending 记录，立即返回 analysisId（秒回）。
//   action='process' : 后台执行——取图片临时地址 → 调千问识别 → 写回 result + completed。
//                      前端不等待此调用，靠 analyzing 页轮询 status 感知进度。
//
// 千问 API Key 从云函数环境变量 DASHSCOPE_API_KEY 读取，绝不写入代码 / 前端 / 仓库。
// 换 Key 只需在云开发控制台改这个环境变量，代码不用动（步骤见 README「更换 API Key」）。
// 需在云开发控制台为本函数设置：环境变量 DASHSCOPE_API_KEY、超时时间 60s。
//
// 依赖：只有 wx-server-sdk。HTTP 请求用 Node 内置的 https，**故意不引入 axios**——
// 云端安装依赖时 axios 会连带拉一串包，是「上传并部署」卡在 99% 的常见原因。
// 少一个第三方依赖，云函数上传就快一截，也更不容易失败。
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'meal_records';
// DashScope OpenAI 兼容模式端点
const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODEL = 'qwen-vl-max'; // 可换 qwen-vl-plus（更省）或 -latest 变体
const PROMPT_VERSION = 'qwen-dish-ingredients-v4';

exports.main = async (event) => {
  // action='ping'：不碰数据库也不碰图片，只用一次最小的文本请求验证
  // DASHSCOPE_API_KEY 配没配对、云函数出不出得了公网。
  // 在云开发控制台「云端测试」里传 {"action":"ping"} 即可，用来把
  // 「Key 的问题」和「图片的问题」一刀切开。
  if (event.action === 'ping') {
    return ping();
  }
  if (event.action === 'process') {
    return processAnalysis(event.analysisId);
  }
  return createAnalysis(event);
};

async function ping() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return { ok: false, stage: '读取环境变量', error: '未配置 DASHSCOPE_API_KEY 环境变量' };
  }
  try {
    const data = await postJson(
      DASHSCOPE_URL,
      { model: MODEL, messages: [{ role: 'user', content: '只回复两个字：通了' }] },
      { Authorization: `Bearer ${apiKey}` },
    );
    const reply =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
    return {
      ok: true,
      model: MODEL,
      keyPrefix: apiKey.slice(0, 8) + '…',
      keyLength: apiKey.length,
      reply,
    };
  } catch (err) {
    return {
      ok: false,
      stage: '调用千问接口',
      keyPrefix: apiKey.slice(0, 8) + '…',
      keyLength: apiKey.length,
      error: String((err && err.message) || err),
    };
  }
}

// ---- action: create ----------------------------------------------------------
async function createAnalysis(event) {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();
  const addRes = await db.collection(COLLECTION).add({
    data: {
      _openid: OPENID, // 显式写入，使「仅创建者可读写」规则放行该用户读取
      imageFileId: event.imageFileId || '',
      imageUrl: event.imageUrl || '',
      status: 'pending',
      modelName: MODEL,
      promptVersion: PROMPT_VERSION,
      result: { dish: null },
      selectedRecords: {},
      errorStage: '',
      errorMessage: '',
      createdAt: now,
      updatedAt: now,
    },
  });
  return { analysisId: addRes._id };
}

// ---- action: process ---------------------------------------------------------
async function processAnalysis(analysisId) {
  if (!analysisId) {
    return { ok: false, error: 'missing analysisId' };
  }
  // 记录当前走到哪一步：失败时连同错误一起写库，前端就能显示「卡在哪一步、为什么」，
  // 而不是笼统的一句「识别失败」。排查线上问题全靠这两个字段。
  let stage = '初始化';
  try {
    stage = '更新任务状态';
    await setStatus(analysisId, 'preprocessing');

    stage = '读取任务记录';
    const doc = (await db.collection(COLLECTION).doc(analysisId).get()).data;

    stage = '获取图片临时地址';
    const imageUrl = await resolveImageUrl(doc.imageFileId);

    stage = '调用千问识别';
    await setStatus(analysisId, 'recognizing');
    const dish = await callQwen(imageUrl);

    stage = '写回识别结果';
    await db.collection(COLLECTION).doc(analysisId).update({
      data: {
        'result.dish': dish,
        status: 'completed',
        errorStage: '',
        errorMessage: '',
        updatedAt: Date.now(),
      },
    });
    return { ok: true };
  } catch (err) {
    const message = String((err && err.message) || err);
    console.error(`[analyzeMeal] process failed at 【${stage}】`, err);
    await db
      .collection(COLLECTION)
      .doc(analysisId)
      .update({
        data: {
          status: 'failed',
          errorStage: stage,
          // 截断：错误里可能带一整段接口响应，没必要整篇存进数据库。
          errorMessage: message.slice(0, 500),
          updatedAt: Date.now(),
        },
      })
      .catch(() => {});
    return { ok: false, stage, error: message };
  }
}

function setStatus(id, status) {
  return db.collection(COLLECTION).doc(id).update({ data: { status, updatedAt: Date.now() } });
}

// 把云存储 fileID 换成千问可拉取的临时 HTTP 地址。
async function resolveImageUrl(fileId) {
  if (!fileId) throw new Error('记录里没有图片 fileId，可能上传步骤没成功');
  if (/^https?:\/\//.test(fileId)) return fileId;
  const res = await cloud.getTempFileURL({ fileList: [fileId] });
  const item = res.fileList && res.fileList[0];
  if (!item || !item.tempFileURL) {
    // 把云存储返回的 errmsg 带出来，「文件不存在」和「没权限」是两回事。
    const detail = item ? `${item.status} ${item.errmsg || ''}` : '无返回项';
    throw new Error(`获取图片临时地址失败：${detail}`);
  }
  return item.tempFileURL;
}

// ---- 千问调用与解析 ----------------------------------------------------------
async function callQwen(imageUrl) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY 环境变量');

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: USER_PROMPT },
        ],
      },
    ],
  };

  const data = await postJson(DASHSCOPE_URL, body, {
    Authorization: `Bearer ${apiKey}`,
  });

  const content =
    data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
  return parseDish(content);
}

/**
 * 用 Node 内置 https 发一个 JSON POST 并把响应解析成对象。
 * 这是 axios 在本函数里唯一被用到的能力，自己写十几行就够，省掉一个第三方依赖。
 */
function postJson(url, body, headers) {
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
            reject(new Error(`千问接口返回 ${res.statusCode}：${text.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error('千问响应不是合法 JSON：' + text.slice(0, 200)));
          }
        });
      },
    );
    // 云函数超时设为 60s，这里留 50s，好让错误由我们自己抛出而不是被平台直接掐断。
    req.setTimeout(50000, () => {
      req.destroy(new Error('调用千问接口超时（50s）'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const SYSTEM_PROMPT =
  '你是专业的中餐菜品识别助手。根据照片说出【一道】菜的菜名、整道菜的烹饪方式，' +
  '以及这道菜里**所有**可分辨的食材及其各自的烹饪方式。不需要估计重量或份量。' +
  '下游会拿每一种食材单独去查实测质构数据，因此食材要尽量列全、不要合并成一个笼统的名字。' +
  '只输出 JSON，不要任何解释文字或 markdown 代码块。';

const USER_PROMPT = [
  '识别照片里最主要的那一道菜（只出一道），并把这道菜里的食材列全。',
  '严格按以下 JSON 结构输出（字段名与类型完全一致）：',
  '{"dish":{"dishName":"string","cookingMethod":"string",' +
    '"recognitionConfidence":"high|medium|low",' +
    '"ingredients":[{"name":"string","cookingMethod":"string"}]}}',
  '约束：',
  '- 图里出现多样菜时，只输出占比最大、最像「主菜」的那一道，不要输出多道；',
  '- dishName 用最常见的中文标准菜名（如 大煮干丝 / 清蒸石斑鱼 / 红烧肉），不要加形容词或份量；',
  '- cookingMethod 用单个简短中文词：煮/炖/蒸/炒/炸/煎/烤/焖/烧/卤/凉拌/白灼/爆炒/红烧/清蒸 等；',
  '- ingredients 要列出这道菜里**每一种**看得见或按这道菜的常规做法必然含有的食材，' +
    '通常 2–6 种，最多 10 种；宁可多列一种，也不要漏掉主料或配菜；',
  '- name 用食材本名并保留刀工形态，如 豆腐丝 / 火腿丝 / 带皮五花肉 / 土豆丝 / 白菜帮；' +
    '不要用「蔬菜」「肉」这种笼统词，也不要写成「土豆和青椒」这种复合名——一种食材一个条目；',
  '- 葱、姜、蒜、香菜、干辣椒、花椒等只起调味作用的配料不要列入；',
  '- 每种食材的 cookingMethod 写它在这道菜里的受热方式（同一道菜里不同食材可以不同，' +
    '如回锅肉里五花肉是「炒」而蒜苗也是「炒」；凉拌菜里生食的写「凉拌」）；',
  '- recognitionConfidence 只能取 "high"/"medium"/"low"；',
  '- 若图中没有可识别的食物，输出 {"dish":null}。',
].join('\n');

function parseDish(content) {
  if (!content) throw new Error('千问返回空内容');
  const json = extractJson(content);
  // 兼容模型仍按数组返回的情况：取第一道。
  const raw = json.dish || (Array.isArray(json.dishes) ? json.dishes[0] : null);
  if (!raw || !raw.dishName) return null;
  return normalizeDish(raw);
}

function extractJson(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('无法解析千问返回的 JSON：' + cleaned.slice(0, 200));
  }
}

const LEVELS = ['high', 'medium', 'low'];
function level(v) {
  return LEVELS.indexOf(v) >= 0 ? v : 'medium';
}

function normalizeDish(d) {
  const dishName = String((d && d.dishName) || '未知菜品').trim();
  const cookingMethod = String((d && d.cookingMethod) || '').trim();
  const rawIngredients = Array.isArray(d && d.ingredients) ? d.ingredients : [];
  const seen = Object.create(null);
  const ingredients = rawIngredients
    .map((ing) => ({
      name: String((ing && ing.name) || '').trim(),
      cookingMethod: String((ing && ing.cookingMethod) || cookingMethod).trim(),
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
    // 模型没拆出食材时，用菜名本身兜底，保证前端至少能做一次食材匹配。
    ingredients: ingredients.length ? ingredients : [{ name: dishName, cookingMethod }],
  };
}
