// 新模型份量校准。参照是用户认可的旧算法快照，不是实称重量。
// 同时缩放体积与直接克数，既有前端的加权几何平均、肉类 0.5 和区间规则继续执行。
// 原始视觉几何量单独留在 modelAudit.rawDish；这里返回的是供估重使用的有效几何量。
const PROFILE = Object.freeze({
  version: '2026-09-28-legacy-proxy-v1',
  referenceType: 'user-approved-legacy-estimate-proxy',
  referenceAlgorithm: '2026-09-15-meat-half',
  factor: 1.9,
  samples: 21,
  sceneGroups: 16,
  fittingMethod: 'median-of-scene-median-log-ratios',
  isWeighedCalibration: false,
});

function applyQuantityCalibration(dish, factor = PROFILE.factor) {
  if (!dish) return null;
  if (!Number.isFinite(factor) || factor <= 0 || factor > 4) throw new Error('份量校准系数非法');
  const items = dish.ingredients.map(i => {
    const volume = i.areaRatio * i.heightCm * factor;
    const heightCm = Math.min(i.heightCm * factor, 8);
    const estimatedG = i.estimatedG * factor;
    if (!(volume > 0) || !(heightCm > 0) || !(estimatedG > 0) || estimatedG > 3000) throw new Error('校准后的份量超出可验证范围');
    return { original: i, volume, heightCm, areaRatio: volume / heightCm, estimatedG };
  });
  // 在原接口的面积/厚度范围内保留校准后的体积，不把超限数据静默夹小。
  const minimumArea = items.reduce((sum, i) => sum + i.volume / 8, 0);
  if (minimumArea > 1) throw new Error('校准体积超出既有餐盘估重范围');
  if (items.reduce((sum, i) => sum + i.areaRatio, 0) > 1) {
    const originalArea = items.reduce((sum, i) => sum + i.original.areaRatio, 0);
    for (const i of items) {
      i.areaRatio = i.volume / 8 + (1 - minimumArea) * i.original.areaRatio / originalArea;
      i.heightCm = i.volume / i.areaRatio;
    }
  }
  return { ...dish, ingredients: items.map(i => ({ ...i.original,
    areaRatio: i.areaRatio, heightCm: i.heightCm, estimatedG: i.estimatedG })) };
}

module.exports = { PROFILE, applyQuantityCalibration };
