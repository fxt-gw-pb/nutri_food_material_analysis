const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

const clone = (value) => JSON.parse(JSON.stringify(value));
let storage, navigation, toasts, chosenImages, uploadedImages, createdMeals;
global.wx = {
  getStorageSync: (key) => storage[key] === undefined ? '' : clone(storage[key]),
  setStorageSync: (key, value) => { storage[key] = clone(value); },
  showToast: (value) => toasts.push(value),
  showLoading() {},
  hideLoading() {},
  navigateTo: (value) => navigation.push(value.url),
  chooseMedia: (options) => {
    chosenImages.push(options);
    options.success({ tempFiles: [{ tempFilePath: '/tmp/meal.jpg' }] });
  },
};

const service = require('../miniprogram/services/mealService.ts');
const profile = require('../miniprogram/services/userProfile.ts');
const definitions = [];
global.Page = (definition) => definitions.push(definition);
require('../miniprogram/pages/index/index.ts');
require('../miniprogram/pages/upload/upload.ts');

function makePage(definition) {
  return {
    ...definition,
    data: clone(definition.data),
    setData(values, callback) {
      Object.assign(this.data, clone(values));
      if (callback) callback();
    },
  };
}

beforeEach((t) => {
  storage = {};
  navigation = [];
  toasts = [];
  chosenImages = [];
  uploadedImages = [];
  createdMeals = [];
  // These tests exercise page validation and submission; no remote records exist.
  t.mock.method(service, 'getPendingMealEvaluation', async () => null);
  t.mock.method(service, 'uploadMealImage', async (path) => {
    uploadedImages.push(path);
    return { fileId: 'cloud://meal', imageUrl: 'cloud://meal' };
  });
  t.mock.method(service, 'createMealAnalysis', async (params) => {
    createdMeals.push(clone(params));
    return { analysisId: 'new-meal' };
  });
  t.mock.method(console, 'error', () => {}); // Empty inputs intentionally take the error path.
});

test('首页空编码不能从任一开始入口进入拍照页', async () => {
  const page = makePage(definitions[0]);
  await page.goUpload();
  page.onParticipantCodeInput({ detail: { value: '   ' } });
  await page.saveAndContinue();

  assert.deepEqual(navigation, []);
  assert.equal(profile.getUserProfile(), null);
  assert.equal(toasts.length, 2);
  assert.ok(toasts.every((toast) => toast.icon === 'none' && /填写.*编码/.test(toast.title)));
});

test('直接进入上传页时，空编码同时阻止选图和上传识别', async () => {
  const page = makePage(definitions[1]);
  page.onLoad();
  page.chooseImage();
  // 即使已有照片或直接调用提交处理器，也不能绕过编码校验。
  page.setData({ imageUrl: '/tmp/existing.jpg', participantCode: '  ' });
  await page.startAnalyze();

  assert.deepEqual(chosenImages, []);
  assert.deepEqual(uploadedImages, []);
  assert.deepEqual(createdMeals, []);
  assert.deepEqual(navigation, []);
  assert.equal(page.data.submitting, false);
  assert.equal(toasts.length, 2);
  assert.ok(toasts.every((toast) => /填写.*编码/.test(toast.title)));
});

test('上传期间修改编码不会改变本次创建参数中的前导零编码快照', async (t) => {
  let releaseUpload;
  let notifyUploadStarted;
  const uploadStarted = new Promise((resolve) => { notifyUploadStarted = resolve; });
  const uploadResult = new Promise((resolve) => { releaseUpload = resolve; });
  t.mock.method(service, 'uploadMealImage', (path) => {
    uploadedImages.push(path);
    notifyUploadStarted();
    return uploadResult;
  });

  const page = makePage(definitions[1]);
  page.onLoad();
  page.onParticipantCodeInput({ detail: { value: '  001207  ' } });
  page.chooseImage();
  assert.equal(chosenImages.length, 1);
  assert.equal(page.data.imageUrl, '/tmp/meal.jpg');
  assert.equal(profile.getUserProfile().participantCode, '001207');

  const submission = page.startAnalyze();
  await uploadStarted;
  assert.equal(page.data.submitting, true);
  page.onParticipantCodeInput({ detail: { value: '009999' } });
  profile.saveUserProfile({ participantCode: '009999' });
  releaseUpload({ fileId: 'cloud://snapshot', imageUrl: 'cloud://snapshot' });
  await submission;

  assert.deepEqual(uploadedImages, ['/tmp/meal.jpg']);
  // 默认用二维码卡片作尺寸参照：不传盘径，识别时对照卡片量出。
  assert.deepEqual(createdMeals, [{
    imageUrl: 'cloud://snapshot',
    imageFileId: 'cloud://snapshot',
    scaleMode: 'qr-card',
    participantCode: '001207',
  }]);
  assert.equal(page.data.participantCode, '009999');
  assert.equal(profile.getUserProfile().participantCode, '009999');
  assert.equal(page.data.submitting, false);
  assert.deepEqual(navigation, ['/pages/analyzing/analyzing?analysisId=new-meal']);
});

test('新打开的上传页 onLoad 恢复本机已保存的编码', () => {
  profile.saveUserProfile({ participantCode: '  000042  ' });
  const page = makePage(definitions[1]);
  assert.equal(page.data.participantCode, '');
  page.onLoad();

  assert.equal(page.data.participantCode, '000042');
  assert.deepEqual(chosenImages, []);
  assert.deepEqual(uploadedImages, []);
});

test('选餐盘直径时照旧传盘径，并记住这次的参照方式', async (t) => {
  t.mock.method(service, 'uploadMealImage', async () => ({ fileId: 'cloud://p', imageUrl: 'cloud://p' }));
  const page = makePage(definitions[1]);
  page.onLoad();
  assert.equal(page.data.scaleMode, 'qr-card');
  page.onParticipantCodeInput({ detail: { value: '001207' } });
  page.chooseImage();
  page.selectScaleMode({ currentTarget: { dataset: { mode: 'plate' } } });
  page.selectDiameter({ currentTarget: { dataset: { value: 22 } } });
  await page.startAnalyze();
  assert.deepEqual(createdMeals, [{ imageUrl: 'cloud://p', imageFileId: 'cloud://p', plateDiameterCm: 22, scaleMode: 'plate', participantCode: '001207' }]);
  const next = makePage(definitions[1]);
  next.onLoad();
  assert.equal(next.data.scaleMode, 'plate');
  assert.equal(next.data.selectedDiameter, 22);
});
