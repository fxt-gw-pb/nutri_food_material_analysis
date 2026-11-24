// 云函数 analyzeMeal —— 菜品识别（千问 Qwen-VL），单段异步。
//
// 本版本做「看图说出这道菜的菜名 + 烹饪方式 + 全部食材 + 每种食材的估重几何量」。
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
const { configuredModel, callQwen, postJson, PROMPT_VERSION, LEGACY_PROMPT_VERSION, ADAPTER_VERSION, TARGET_MODEL } = require('./vision');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
// 更新指令。CloudBase 更新嵌套对象时会把它拍平成点路径（result.dish.dishName…），
// 遇到 result.dish 当前是 null 就会报「Cannot create field ... in element {dish: null}」。
// _.set(obj) 表示「把这个字段整体替换成该对象」，不走合并，正是这里需要的语义。
const _ = db.command;

const COLLECTION = 'meal_records';
const MODEL = configuredModel();

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
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      { model: MODEL, ...(MODEL === TARGET_MODEL ? { enable_thinking: false, max_tokens: 32 } : {}), messages: [{ role: 'user', content: '只回复两个字：通了' }] },
      { Authorization: `Bearer ${apiKey}` },
    );
    const reply =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : '';
    return {
      ok: true,
      model: MODEL,
      resolvedModel: data.model || MODEL,
      adapterVersion: ADAPTER_VERSION,
      reply,
    };
  } catch (err) {
    return {
      ok: false,
      stage: '调用千问接口',
      adapterVersion: ADAPTER_VERSION,
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
      participantCode: typeof event.participantCode === 'string' ? event.participantCode.trim().slice(0, 32) : '',
      mealSessionId: typeof event.mealSessionId === 'string' ? event.mealSessionId.trim().slice(0, 80) : '',
      // 估重的尺度基准。没传就按 26cm 家用菜盘兜底，否则整条估重链路无从下手。
      plateDiameterCm: Number(event.plateDiameterCm) > 0 ? Number(event.plateDiameterCm) : 26,
      status: 'pending',
      modelName: MODEL,
      promptVersion: MODEL === TARGET_MODEL ? PROMPT_VERSION : LEGACY_PROMPT_VERSION,
      adapterVersion: ADAPTER_VERSION,
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
    stage = '读取任务记录';
    const doc = (await db.collection(COLLECTION).doc(analysisId).get()).data;
    // 用户在分析过程中要求重拍后，旧任务不能再写回 completed。
    if (doc.status === 'discarded') return { ok: true, discarded: true };
    // 升级后重复 process 不得用新模型覆盖旧餐的结果、改选或评估。
    if (doc.status === 'completed') return { ok: true, alreadyCompleted: true };

    stage = '更新任务状态';
    await setStatus(analysisId, 'preprocessing');

    stage = '获取图片临时地址';
    const imageUrl = await resolveImageUrl(doc.imageFileId);

    stage = '调用千问识别';
    await setStatus(analysisId, 'recognizing');
    const plateDiameterCm = Number(doc.plateDiameterCm) > 0 ? Number(doc.plateDiameterCm) : 26;
    const response = await callQwen(imageUrl, plateDiameterCm);
    const { dish, ...modelAudit } = response;

    const latest = (await db.collection(COLLECTION).doc(analysisId).get()).data;
    if (latest.status === 'discarded') return { ok: true, discarded: true };

    stage = '写回识别结果';
    await db.collection(COLLECTION).doc(analysisId).update({
      data: {
        // 必须用 _.set：dish 是个嵌套对象，直接赋值会被拍平成
        // result.dish.dishName / result.dish.cookingMethod…，
        // 而 result.dish 初始为 null，Mongo 无法在 null 上创建子字段。
        'result.dish': _.set(dish),
        // 以实际执行请求为准，兼容 create / process 跨部署发生。
        modelName: modelAudit.modelName,
        promptVersion: modelAudit.promptVersion,
        adapterVersion: ADAPTER_VERSION,
        modelAudit: _.set(modelAudit),
        status: 'completed',
        errorStage: '',
        errorMessage: '',
        updatedAt: Date.now(),
      },
    });
    return { ok: true };
  } catch (err) {
    const message = String((err && err.message) || err);
    const latest = await db.collection(COLLECTION).doc(analysisId).get().catch(() => null);
    if (latest && latest.data && latest.data.status === 'discarded') return { ok: true, discarded: true };
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
