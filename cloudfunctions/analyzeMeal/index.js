// 云函数 analyzeMeal —— 菜品识别（千问 Qwen-VL），单段异步。
//
// 本版本只做「看图说出菜名 + 烹饪方式 + 原食材」，不再估算任何重量。
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
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'meal_records';
// DashScope OpenAI 兼容模式端点
const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MODEL = 'qwen-vl-max'; // 可换 qwen-vl-plus（更省）或 -latest 变体
const PROMPT_VERSION = 'qwen-dish-recognition-v2';

exports.main = async (event) => {
  if (event.action === 'process') {
    return processAnalysis(event.analysisId);
  }
  return createAnalysis(event);
};

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
      result: { dishes: [] },
      selections: [],
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
  try {
    await setStatus(analysisId, 'preprocessing');
    const doc = (await db.collection(COLLECTION).doc(analysisId).get()).data;
    const imageUrl = await resolveImageUrl(doc.imageFileId);

    await setStatus(analysisId, 'recognizing');
    const dishes = await callQwen(imageUrl);

    await db.collection(COLLECTION).doc(analysisId).update({
      data: { 'result.dishes': dishes, status: 'completed', updatedAt: Date.now() },
    });
    return { ok: true };
  } catch (err) {
    console.error('[analyzeMeal] process failed', err);
    await setStatus(analysisId, 'failed').catch(() => {});
    return { ok: false, error: String((err && err.message) || err) };
  }
}

function setStatus(id, status) {
  return db.collection(COLLECTION).doc(id).update({ data: { status, updatedAt: Date.now() } });
}

// 把云存储 fileID 换成千问可拉取的临时 HTTP 地址。
async function resolveImageUrl(fileId) {
  if (!fileId) throw new Error('缺少图片 fileId');
  if (/^https?:\/\//.test(fileId)) return fileId;
  const res = await cloud.getTempFileURL({ fileList: [fileId] });
  const item = res.fileList && res.fileList[0];
  if (!item || !item.tempFileURL) throw new Error('获取图片临时地址失败');
  return item.tempFileURL;
}

// ---- 千问调用与解析 ----------------------------------------------------------
async function callQwen(imageUrl) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('未配置 DASHSCOPE_API_KEY 环境变量');

  const resp = await axios.post(
    DASHSCOPE_URL,
    {
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
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 50000,
    },
  );

  const content =
    resp.data && resp.data.choices && resp.data.choices[0] && resp.data.choices[0].message
      ? resp.data.choices[0].message.content
      : '';
  return parseDishes(content);
}

const SYSTEM_PROMPT =
  '你是专业的中餐菜品识别助手。根据餐盘照片说出每一道菜的菜名、整道菜的烹饪方式，' +
  '以及这道菜里可分辨的原食材及其各自的烹饪方式。不需要估计重量或份量。' +
  '只输出 JSON，不要任何解释文字或 markdown 代码块。';

const USER_PROMPT = [
  '识别照片里的每一道菜，严格按以下 JSON 结构输出（字段名与类型完全一致）：',
  '{"dishes":[{"dishName":"string","cookingMethod":"string",' +
    '"recognitionConfidence":"high|medium|low",' +
    '"ingredients":[{"name":"string","cookingMethod":"string"}]}]}',
  '约束：',
  '- dishName 用最常见的中文标准菜名（如 大煮干丝 / 清蒸石斑鱼 / 红烧肉），不要加形容词或份量；',
  '- cookingMethod 用单个简短中文词：煮/炖/蒸/炒/炸/煎/烤/焖/烧/卤/凉拌/白灼/爆炒/红烧/清蒸 等；',
  '- ingredients 列出这道菜中肉眼可分辨的主要原食材（一般 1–4 种），name 用食材本名并保留刀工，' +
    '如 豆腐丝 / 火腿丝 / 排骨 / 白菜帮；每种食材的 cookingMethod 写它在这道菜里的受热方式；',
  '- recognitionConfidence 只能取 "high"/"medium"/"low"；',
  '- 若图中没有可识别的食物，dishes 返回空数组 []。',
].join('\n');

function parseDishes(content) {
  if (!content) throw new Error('千问返回空内容');
  const json = extractJson(content);
  const arr = Array.isArray(json.dishes) ? json.dishes : [];
  return arr.map((d, i) => normalizeDish(d, i));
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

function normalizeDish(d, i) {
  const dishName = String((d && d.dishName) || '未知菜品').trim();
  const cookingMethod = String((d && d.cookingMethod) || '').trim();
  const rawIngredients = Array.isArray(d && d.ingredients) ? d.ingredients : [];
  const ingredients = rawIngredients
    .map((ing) => ({
      name: String((ing && ing.name) || '').trim(),
      cookingMethod: String((ing && ing.cookingMethod) || cookingMethod).trim(),
    }))
    .filter((ing) => ing.name);
  return {
    dishId: `dish_${i + 1}`,
    dishName,
    cookingMethod,
    recognitionConfidence: level(d && d.recognitionConfidence),
    // 模型没拆出食材时，用菜名本身兜底，保证前端至少能做一次食材匹配。
    ingredients: ingredients.length ? ingredients : [{ name: dishName, cookingMethod }],
  };
}
