const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
}).outputText, filename);

let storage = {};
let failWrite = false;
global.wx = {
  getStorageSync: (key) => storage[key] === undefined ? '' : storage[key],
  setStorageSync: (key, value) => { if (failWrite) throw new Error('storage full'); storage[key] = value; },
};

const profile = require('../miniprogram/services/userProfile.ts');

test('个人编码保留前导零并在本机持久化', () => {
  storage = {};
  const saved = profile.saveUserProfile({ participantCode: '  001207  ' });
  assert.equal(saved.participantCode, '001207');
  assert.deepEqual(profile.getUserProfile(), { participantCode: '001207' });
});

test('个人编码为空或超长时拒绝，存储失败不返回成功', () => {
  assert.throws(() => profile.normalizeParticipantCode('   '), /填写/);
  assert.throws(() => profile.normalizeParticipantCode('x'.repeat(33)), /32/);
  failWrite = true;
  assert.throws(() => profile.saveUserProfile({ participantCode: 'A1' }), /保存失败/);
  failWrite = false;
});
