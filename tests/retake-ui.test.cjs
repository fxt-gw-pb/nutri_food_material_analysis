const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

let storage = {}; const navigation = []; let modalAnswer = { confirm: true }; let modalSequence = null; let events = [];
global.wx = {
  getStorageSync: (k) => storage[k] === undefined ? '' : storage[k],
  setStorageSync: (k, v) => { storage[k] = v; }, removeStorageSync: (k) => { delete storage[k]; },
  showModal: async () => modalSequence ? modalSequence.shift() : modalAnswer,
  showToast: (v) => events.push(['toast', v.title]),
  reLaunch: (v) => { navigation.push(v.url); events.push(['navigate']); },
};
const service = require('../miniprogram/services/mealService.ts');
const { confirmRetake } = require('../miniprogram/utils/retakeNavigation.ts');

for (const page of ['result', 'evaluation', 'detail']) {
  test(`${page} exposes a visible retake action`, () => {
    const wxml = fs.readFileSync(`${__dirname}/../miniprogram/pages/${page}/${page}.wxml`, 'utf8');
    assert.match(wxml, /我要重新拍照/);
    assert.match(fs.readFileSync(`${__dirname}/../miniprogram/pages/${page}/${page}.ts`, 'utf8'), /confirmRetake/);
  });
}

test('retake waits for evaluation writes before discarding and navigating', async () => {
  events = []; navigation.length = 0; storage = { evaluation_draft_cloud_x: { percentages: { 土豆: 50 } } }; modalAnswer = { confirm: true };
  const original = service.discardMealAnalysis;
  service.discardMealAnalysis = async () => { events.push(['discard']); };
  let release; const queue = new Promise((resolve) => { release = resolve; });
  const pending = confirmRetake('x', queue);
  await Promise.resolve();
  assert.deepEqual(events, []);
  release(); await pending;
  assert.deepEqual(events, [['discard'], ['navigate']]);
  assert.deepEqual(navigation, ['/pages/upload/upload']);
  assert.equal(storage.evaluation_draft_cloud_x, undefined);
  service.discardMealAnalysis = original;
});

test('discard failure leaves the current page in place', async () => {
  events = []; navigation.length = 0; modalAnswer = { confirm: true };
  const original = service.discardMealAnalysis;
  service.discardMealAnalysis = async () => { throw new Error('offline'); };
  assert.equal(await confirmRetake('x'), false);
  assert.deepEqual(navigation, []);
  assert.deepEqual(events, [['toast', '重新拍照失败，请重试']]);
  service.discardMealAnalysis = original;
});

test('cancel does not discard', async () => {
  events = []; navigation.length = 0; modalAnswer = { confirm: false, cancel: true };
  assert.equal(await confirmRetake('x'), false);
  assert.deepEqual(navigation, []);
});

test('pending prompt cancel opens the same retake confirmation and blocks new navigation', async () => {
  const navigationModule = require('../miniprogram/utils/evaluationNavigation.ts');
  const oldPending = service.getPendingMealEvaluation;
  const oldDiscard = service.discardMealAnalysis;
  service.getPendingMealEvaluation = async () => ({ analysisId: 'pending-1' });
  service.discardMealAnalysis = async () => { events.push(['discard-pending']); };
  events = []; navigation.length = 0;
  modalSequence = [{ confirm: false, cancel: true }, { confirm: true }];
  assert.equal(await navigationModule.checkPendingEvaluation(), false);
  assert.deepEqual(events, [['discard-pending'], ['navigate']]);
  assert.deepEqual(navigation, ['/pages/upload/upload']);
  service.getPendingMealEvaluation = oldPending;
  service.discardMealAnalysis = oldDiscard;
  modalSequence = null;
});

for (const page of ['result', 'evaluation', 'detail']) {
  test(`${page} retake action is locked while busy`, () => {
    const source = fs.readFileSync(`${__dirname}/../miniprogram/pages/${page}/${page}.ts`, 'utf8');
    const wxml = fs.readFileSync(`${__dirname}/../miniprogram/pages/${page}/${page}.wxml`, 'utf8');
    assert.match(source, /async retake\(\)[\s\S]{0,180}this\.data\.busy/);
    assert.match(wxml, /bindtap=\"retake\"[\s\S]*disabled=\"\{\{busy \|\| !loaded\}\}\"/);
  });
}
