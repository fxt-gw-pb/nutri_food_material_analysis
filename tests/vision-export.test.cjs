const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildFullTables } = require('../scripts/export/full.cjs');
const { buildTables } = require('../scripts/export/core.cjs');
const { PROFILE, applyQuantityCalibration } = require('../cloudfunctions/analyzeMeal/quantityCalibration');

test('导出区分原始模型预测和云端校准参数，并保留参照类型', () => {
  const rawDish = { dishName:'牛肉', cookingMethod:'炖', weightConfidence:'medium', ingredients:[
    { name:'牛肉',cookingMethod:'炖',areaRatio:.1,heightCm:1,estimatedG:100,weightConfidence:'medium' },
  ] };
  const record = { _id:'synthetic-calibration-export',participantCode:'TEST',status:'completed',createdAt:1,plateDiameterCm:26,
    result:{dish:applyQuantityCalibration(rawDish)},modelAudit:{rawDish,quantityCalibration:PROFILE} };
  const before=JSON.stringify(record);
  const full=buildFullTables([record]).tables;
  const basic=buildTables([record]).tables;
  for (const row of [full.ingredients_full[0],basic.ingredients[0]]) {
    assert.equal(row.model_estimated_g,100);
    assert.equal(row.height_cm,1);
    assert.equal(row.effective_estimated_g,190);
    assert.equal(row.effective_height_cm,1.9);
    assert.equal(row.quantity_calibration_factor,1.9);
    assert.equal(row.calibration_reference_type,'user-approved-legacy-estimate-proxy');
  }
  assert.equal(JSON.parse(full.records[0].raw_modelAudit).rawDish.ingredients[0].estimatedG,100);
  assert.equal(JSON.stringify(record),before);
});
