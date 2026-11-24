#!/usr/bin/env node
// 离线对照入口：只把照片发送到项目原有百炼接口，不连接或写入研究数据库。
// manifest: [{id:"sample-01",imagePath:"/absolute/photo.jpg",plateDiameterCm:26}]
// DASHSCOPE_API_KEY 由调用者环境提供。结果不记录凭据、照片 URL 或参与者资料。
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { TARGET_MODEL, LEGACY_MODEL, callQwen } = require('../../cloudfunctions/analyzeMeal/vision');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);
const { resolveMeal } = require('../../miniprogram/utils/texture.ts');
async function compare(manifest, output) {
  if (!process.env.DASHSCOPE_API_KEY) throw Error('请在当前进程环境提供 DASHSCOPE_API_KEY；不要写入项目或命令行参数');
  const samples = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (!Array.isArray(samples) || !samples.length) throw Error('样本清单不能为空');
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    const imagePath = path.resolve(path.dirname(manifest), sample.imagePath);
    const mime = /\.png$/i.test(imagePath) ? 'image/png' : /\.webp$/i.test(imagePath) ? 'image/webp' : 'image/jpeg';
    const imageUrl = `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
    const row = { sample: index + 1, plateDiameterCm: sample.plateDiameterCm || 26, models: {} };
    for (const model of [LEGACY_MODEL, TARGET_MODEL]) {
      try {
        const result = await callQwen(imageUrl, row.plateDiameterCm, { model });
        const resolved = resolveMeal(result.dish, {}, row.plateDiameterCm);
        row.models[model] = { ok: true, foodDetected: result.dish !== null, ...result, totalG: resolved.totalG, ingredients: resolved.ingredients.map(i => ({ name: i.name, grams: i.grams, recordId: i.recordId, weightBasis: i.weightBasis })) };
      } catch (error) { row.models[model] = { ok: false, error: error.message }; }
    }
    results.push(row);
    fs.writeFileSync(path.join(output, 'comparison.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(`完成样本 ${index + 1}/${samples.length}：旧模型 ${row.models[LEGACY_MODEL].ok ? '通过' : '失败'}，新模型 ${row.models[TARGET_MODEL].ok ? '通过' : '失败'}`);
  }
  const summary = { samples: results.length, models: {}, groundTruthAvailable: false,
    note: '接口和规则兼容性验证，不等同于人工识别准确率或实称重量精度验证。' };
  for (const model of [LEGACY_MODEL, TARGET_MODEL]) {
    const ok = results.map(r => r.models[model]).filter(r => r.ok);
    summary.models[model] = { success: ok.length, failed: results.length - ok.length, emptyResults: ok.filter(r => !r.foodDetected).length,
      maxElapsedMs: ok.length ? Math.max(...ok.map(r => r.elapsedMs)) : null };
  }
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}
if (require.main === module) {
  const [manifest, output] = process.argv.slice(2);
  if (!manifest || !output) { console.error('用法：node scripts/vision/compare.cjs samples.json exports/vision-comparison'); process.exitCode = 1; }
  else compare(path.resolve(manifest), path.resolve(output)).then(s => console.log(JSON.stringify(s, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { compare };
