const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const clone = (value) => JSON.parse(JSON.stringify(value));
const dish = {
  dishName: '土豆炖牛肉', cookingMethod: '炖', recognitionConfidence: 'high',
  ingredients: [{ name: '牛肉', estimatedG: 200 }, { name: '土豆', estimatedG: 100 }],
};
let documents = {};
let storage = {};
let nextId = 0;
const database = {
  command: { set: (value) => ({ replacement: value }) },
  collection() {
    let filter = {};
    let count = Infinity;
    let offset = 0;
    const query = {
      where(value) { filter = value; return query; },
      orderBy() { return query; },
      skip(value) { offset = value; return query; },
      limit(value) { count = value; return query; },
      async get() {
        return { data: Object.values(documents)
          .filter((document) => Object.entries(filter).every(([key, value]) => document[key] === value))
          .slice(offset, offset + count).map(clone) };
      },
      doc(id) {
        return {
          async get() { assert.ok(documents[id], `missing ${id}`); return { data: clone(documents[id]) }; },
          async update({ data }) {
            assert.ok(documents[id], `missing ${id}`);
            for (const [key, value] of Object.entries(data)) {
              documents[id][key] = clone(value && 'replacement' in Object(value) ? value.replacement : value);
            }
            return { stats: { updated: 1 } };
          },
        };
      },
    };
    return query;
  },
};

global.wx = {
  getStorageSync(key) { return storage[key] === undefined ? '' : clone(storage[key]); },
  setStorageSync(key, value) { storage[key] = clone(value); },
  cloud: {
    database: () => database,
    async callFunction({ data }) {
      if (data.action === 'create') {
        const id = `cloud-meal-${++nextId}`;
        documents[id] = {
          _id: id, imageUrl: data.imageUrl, participantCode: data.participantCode,
          mealSessionId: data.mealSessionId, plateDiameterCm: data.plateDiameterCm,
          status: 'pending', result: { dish: clone(dish) }, createdAt: Date.now(), updatedAt: Date.now(),
        };
        return { result: { analysisId: id } };
      }
      if (data.action === 'process') documents[data.analysisId].status = 'completed';
      return { result: {} };
    },
  },
};

const cloud = require('../miniprogram/services/mealService.cloud.ts');
const mock = require('../miniprogram/services/mealService.mock.ts');
const profile = require('../miniprogram/services/userProfile.ts');
const { buildConsumption } = require('../miniprogram/utils/evaluation.ts');

function reset() {
  documents = {};
  storage = { meal_records_v3: [], meal_seeded_v3: true };
  nextId = 0;
}

function seedLegacy(service) {
  const meal = {
    analysisId: 'legacy-meal', imageUrl: 'legacy.jpg', status: 'completed',
    dish: clone(dish), plateDiameterCm: 26, evaluationStatus: 'pending', createdAt: 1, updatedAt: 1,
    // A previously saved evaluation with a stale code must not supply the missing photo identity.
    consumption: { participantCode: 'STALE', percentages: {}, consumedGrams: {}, totalConsumedG: 0, updatedAt: 1 },
  };
  if (service === cloud) {
    const { analysisId, dish: originalDish, ...rest } = meal;
    documents[analysisId] = { _id: analysisId, ...rest, result: { dish: originalDish } };
  } else {
    storage.meal_records_v3 = [meal];
  }
  return meal.analysisId;
}

async function createCompletedMeal(service, participantCode, imageUrl) {
  profile.saveUserProfile({ participantCode });
  const { analysisId } = await service.createMealAnalysis({
    imageUrl, participantCode: profile.getUserProfile().participantCode,
    plateDiameterCm: 26, mealSessionId: 'shared-phone-session',
  });
  if (service === mock) {
    const record = storage.meal_records_v3.find((item) => item.analysisId === analysisId);
    record.status = 'completed';
    record.dish = clone(dish);
  }
  return analysisId;
}

for (const [name, service] of [['cloud', cloud], ['mock', mock]]) {
  test(`${name}: 同一手机两位参与者的草稿、完成评估和历史固定关联原始编号`, async () => {
    reset();
    const firstId = await createCompletedMeal(service, '001207', 'first.jpg');
    const secondId = await createCompletedMeal(service, '000008', 'second.jpg');
    assert.notEqual(firstId, secondId);
    profile.saveUserProfile({ participantCode: 'CURRENT-PHONE-USER' });

    await service.saveConsumptionEvaluation(secondId, { 牛肉: 25 }, false);
    await service.saveConsumptionEvaluation(firstId, { 土豆: 50 }, false);
    for (const [id, code, percentages] of [
      [firstId, '001207', { 土豆: 50 }], [secondId, '000008', { 牛肉: 25 }],
    ]) {
      const reloaded = await service.getMealAnalysisResult(id);
      assert.equal(reloaded.participantCode, code);
      assert.equal(reloaded.consumption.analysisId, id);
      assert.equal(reloaded.consumption.participantCode, code);
      assert.deepEqual(reloaded.consumption.percentages, percentages);
      assert.equal(reloaded.evaluationStatus, 'pending');
    }

    profile.saveUserProfile({ participantCode: 'ANOTHER-PHONE-USER' });
    await service.saveConsumptionEvaluation(firstId, { 牛肉: 100, 土豆: 50 }, true);
    await service.saveConsumptionEvaluation(secondId, { 牛肉: 25, 土豆: 0 }, true);
    const history = await service.getMealHistory();
    for (const [id, code, percentages] of [
      [firstId, '001207', { 牛肉: 100, 土豆: 50 }], [secondId, '000008', { 牛肉: 25, 土豆: 0 }],
    ]) {
      const reloaded = await service.getMealAnalysisResult(id);
      assert.equal(reloaded.participantCode, code);
      assert.equal(reloaded.consumption.analysisId, id);
      assert.equal(reloaded.consumption.participantCode, code);
      assert.deepEqual(reloaded.consumption.percentages, percentages);
      assert.equal(reloaded.evaluationStatus, 'completed');
      assert.ok(reloaded.consumption.completedAt);
      const item = history.find((record) => record.analysisId === id);
      assert.equal(item.participantCode, code);
      assert.equal(item.evaluationStatus, 'completed');
      assert.equal(item.totalConsumedG, reloaded.consumption.totalConsumedG);
    }
    assert.equal(profile.getUserProfile().participantCode, 'ANOTHER-PHONE-USER');
  });

  test(`${name}: 缺少原始编号的旧记录不取当前手机或旧评估中的编号`, async () => {
    reset();
    profile.saveUserProfile({ participantCode: '009999' });
    const id = seedLegacy(service);
    await service.saveConsumptionEvaluation(id, { 土豆: 40 }, false);
    let reloaded = await service.getMealAnalysisResult(id);
    assert.equal(reloaded.consumption.analysisId, id);
    assert.equal(reloaded.consumption.participantCode, undefined);
    assert.equal(reloaded.participantCode, undefined);
    await service.saveConsumptionEvaluation(id, { 牛肉: 100, 土豆: 40 }, true);
    reloaded = await service.getMealAnalysisResult(id);
    assert.equal(reloaded.consumption.analysisId, id);
    assert.equal(reloaded.consumption.participantCode, undefined);
    assert.equal((await service.getMealHistory())[0].participantCode, undefined);
  });

  test(`${name}: 排除食材重建评估时仍使用该菜品的原始身份`, async () => {
    reset();
    const id = await createCompletedMeal(service, '000001', 'original.jpg');
    await service.saveConsumptionEvaluation(id, { 牛肉: 100, 土豆: 50 }, true);
    profile.saveUserProfile({ participantCode: '000002' });
    await service.saveExcludedIngredients(id, ['牛肉']);
    const reloaded = await service.getMealAnalysisResult(id);
    assert.equal(reloaded.consumption.analysisId, id);
    assert.equal(reloaded.consumption.participantCode, '000001');
    assert.deepEqual(reloaded.consumption.percentages, { 土豆: 50 });
    assert.equal(reloaded.evaluationStatus, 'completed');
  });
}

test('评估身份来自传入菜品记录，编号始终保留为文本', () => {
  reset();
  profile.saveUserProfile({ participantCode: 'MOBILE-PROFILE' });
  const meal = { analysisId: 'original-dish', participantCode: '000007', dish: clone(dish), plateDiameterCm: 26 };
  const consumption = buildConsumption(meal, { 牛肉: 100, 土豆: 100 }, true);
  assert.equal(consumption.analysisId, 'original-dish');
  assert.equal(consumption.participantCode, '000007');
});
