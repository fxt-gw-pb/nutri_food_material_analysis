#!/usr/bin/env node
// 用用户认可的旧估重快照作为代理参照；按菜品/拍摄场景留组验证。
// 不读取密钥，不调用模型，不写研究数据库。
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);
const { resolveMeal } = require('../../miniprogram/utils/texture.ts');
const { applyQuantityCalibration } = require('../../cloudfunctions/analyzeMeal/quantityCalibration');
const median = (values) => {
  const a = values.slice().sort((x, y) => x - y);
  return (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2;
};
function fitCalibration(references, groups) {
  const bySample = new Map(references.map(r => [r.sample, r]));
  const logs = groups.map(group => median(group.map(id => {
    const r = bySample.get(id);
    if (!r || !(r.totalG > 0) || !(r.newTotalG > 0)) throw Error('校准参照缺失或非正值');
    return Math.log(r.totalG / r.newTotalG);
  })));
  return Math.round(Math.exp(median(logs)) * 20) / 20;
}
function metrics(rows, key) {
  const errors = rows.map(r => Math.abs(r[key] / r.referenceG - 1));
  return { count: rows.length,
    MAE: rows.reduce((sum, r) => sum + Math.abs(r[key] - r.referenceG), 0) / rows.length,
    medianAbsolutePercentError: median(errors),
    meanAbsolutePercentError: errors.reduce((a, b) => a + b, 0) / errors.length,
    medianPredictionReferenceRatio: median(rows.map(r => r[key] / r.referenceG)),
    within30percent: errors.filter(e => e <= .3).length,
    within50percent: errors.filter(e => e <= .5).length };
}
function validateCalibration(references, predictions, groups) {
  const ids = groups.flat();
  if (new Set(ids).size !== ids.length || ids.length !== references.length || references.some(r => !ids.includes(r.sample))) throw Error('场景分组必须恰好覆盖全部参照且不重复');
  if (groups.length < 3) throw Error('独立场景组不足');
  references = references.map(r => {
    const prediction = predictions.find(p => p.sample === r.sample);
    const raw = prediction?.rawDish || prediction?.dish;
    if (!raw || (prediction.quantityCalibration && !prediction.rawDish)) throw Error('校准需要原始模型预测，不能再次使用已校准参数');
    const rawG = resolveMeal(raw, {}, r.plateDiameterCm).totalG;
    if (!(rawG > 0) || (r.newTotalG != null && Math.abs(r.newTotalG - rawG) > 1e-6)) throw Error('参照中的新模型基准重量与原始预测不一致');
    return { ...r, newTotalG: rawG };
  });
  const factor = fitCalibration(references, groups);
  const rows = references.map(r => {
    const group = groups.findIndex(g => g.includes(r.sample));
    const heldOutFactor = fitCalibration(references, groups.filter((_, i) => i !== group));
    const input = predictions.find(p => p.sample === r.sample);
    if (!input || !input.dish) throw Error('缺少候选模型原始食材');
    const predict = k => resolveMeal(applyQuantityCalibration(input.rawDish || input.dish, k), {}, r.plateDiameterCm).totalG;
    return { sample: r.sample, group, referenceG: r.totalG, rawG: r.newTotalG,
      heldOutFactor, heldOutG: predict(heldOutFactor), calibratedG: predict(factor) };
  });
  return { referenceType: 'user-approved-legacy-estimate-proxy', isWeighedCalibration: false,
    validation: 'leave-one-scene-group-out', sampleCount: rows.length, sceneGroupCount: groups.length,
    factor, groups, before: metrics(rows, 'rawG'), heldOut: metrics(rows, 'heldOutG'), fitted: metrics(rows, 'calibratedG'), rows };
}
if (require.main === module) {
  const [references, predictions, groups, output] = process.argv.slice(2);
  if (!output) { console.error('用法：node scripts/vision/calibrate.cjs references.json predictions.json groups.json output.json'); process.exitCode = 1; }
  else {
    const read = f => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'));
    const report = validateCalibration(read(references), read(predictions), read(groups));
    fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ factor: report.factor, before: report.before, heldOut: report.heldOut, fitted: report.fitted }, null, 2));
  }
}
module.exports = { fitCalibration, validateCalibration };
