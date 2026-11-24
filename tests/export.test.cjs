const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const core = require('../scripts/export/core.cjs');
const { parseArgs } = require('../scripts/export-meals.cjs');
const { parseDownloadResult, downloadAndExport } = require('../scripts/export-cloud.cjs');
const samplePath = path.join(core.ROOT, 'examples/export/meal_records.json');
const sample = () => core.parseRecords(fs.readFileSync(samplePath, 'utf8'));
const library = core.loadTextureLibrary();

test('默认排除作废及已删除食材，双模式质构不重复食材摄入量', () => {
  const { tables, summary } = core.buildTables(sample(), {}, library);
  assert.equal(summary.inputRecords, 5);
  assert.equal(summary.exportedRecords, 4);
  assert.equal(summary.skippedStatus, 1);
  assert.equal(tables.ingredients.length, 4);
  assert.equal(tables.ingredients.find((r) => r.record_id === 'demo-completed').consumed_g, 50);
  assert.equal(tables.ingredients.some((r) => r.ingredient_name === '香菜'), false);
  assert.equal(tables.textures.length, 2);
  assert.equal(tables.textures[0].hardness_gf, 489.948);
  assert.equal(tables.textures[1].hardness_gf, 481.39);
  assert.equal(tables.textures[0].adhesiveness_gf_sec, -0.3);
  assert.equal(tables.meals[0].issues, '');
});

test('未填写与0不同：旧数据不重算，未评估记录不伪装为已完成', () => {
  const { tables } = core.buildTables(sample(), {}, library);
  const zero = tables.ingredients.find((r) => r.record_id === 'demo-zero');
  assert.equal(zero.consumed_percent, 0);
  assert.equal(zero.consumed_g, 0);
  const legacy = tables.ingredients.find((r) => r.record_id === 'demo-legacy');
  assert.equal(legacy.estimated_g, '');
  assert.equal(legacy.model_estimated_g, 80);
  assert.equal(legacy.consumed_g, '');
  assert.equal(legacy.evaluation_complete, 0);
  assert.match(legacy.issues, /missing_ingredient_snapshot/);
  assert.equal(tables.ingredients.find((r) => r.record_id === 'demo-pending').consumed_percent, '');
});

test('编码按原文本精确筛选，审计选项显式包含作废及排除食材', () => {
  assert.equal(core.buildTables(sample(), { participant: '001207', completedOnly: true }, library).tables.meals.length, 2);
  assert.equal(core.buildTables(sample(), { participant: '1207' }, library).tables.meals.length, 0);
  const { tables } = core.buildTables(sample(), { allRecords: true, includeExcluded: true }, library);
  assert.equal(tables.meals.length, 5);
  assert.equal(tables.ingredients.find((r) => r.ingredient_name === '香菜').excluded, 1);
});

test('按UTC+8日期筛选，起止日包含整天；无效日期不静默放行', () => {
  const rows = ['2026-09-26T15:59:59.999Z', '2026-09-26T16:00:00Z', '2026-09-27T15:59:59.999Z', '2026-09-27T16:00:00Z', null]
    .map((time, i) => ({ ...sample()[1], _id: `boundary-${i}`, createdAt: time }));
  const { tables, summary } = core.buildTables(rows, { from: '2026-09-27', to: '2026-09-27' }, library);
  assert.deepEqual(tables.meals.map((r) => r.record_id), ['boundary-1', 'boundary-2']);
  assert.equal(summary.skippedInvalidDate, 1);
  assert.throws(() => core.day('2026-02-30'), /无效日期/);
  assert.throws(() => parseArgs(['--from', '2026-09-28', '--to', '2026-09-27']), /不能晚于/);
  assert.equal(core.iso({ $date: { $numberLong: String(core.day('2026-09-27')) } }), '2026-09-27T00:00:00.000+08:00');
  assert.equal(core.iso(8640000000000000), '');
});

test('支持BOM、JSON数组、JSONL、单条和data数组，拒绝损坏及重复记录', () => {
  const records = sample();
  for (const content of ['\uFEFF' + JSON.stringify(records), records.map(JSON.stringify).join('\r\n\r\n'), JSON.stringify({ data: records })]) {
    assert.equal(core.parseRecords(content).length, records.length);
  }
  assert.equal(core.parseRecords(JSON.stringify(records[0])).length, 1);
  assert.deepEqual(core.parseRecords('[]'), []);
  assert.throws(() => core.parseRecords(''), /输入文件为空/);
  assert.throws(() => core.parseRecords('{}'), /未找到记录数组/);
  assert.throws(() => core.parseRecords(JSON.stringify(records[0]) + '\n{broken'), /第 2 行/);
  assert.throws(() => core.parseRecords(JSON.stringify([records[0], records[0]])), /重复/);
  assert.throws(() => core.parseRecords(JSON.stringify([{ ...records[0], participantCode: 1207 }])), /不是文本/);
  assert.throws(() => core.parseRecords(JSON.stringify([{ ...records[0], result: { dish: {} } }])), /缺少食材数组/);
  assert.throws(() => core.parseRecords(JSON.stringify([{ ...records[0], consumption: { percentages: [] } }])), /映射格式错误/);
  assert.throws(() => core.parseRecords(JSON.stringify([{ ...records[0], result: { dish: { ingredients: [{ name: '牛肉' }, { name: '牛肉' }] } } }])), /名称缺失或重复/);
});

test('缺失或歧义质构来源不猜测实测值；异常比例及已完成缺项显式标记', () => {
  const record = sample()[0];
  record.auditSnapshot.ingredients[0].sources[0].source = '不存在的来源.xlsx';
  record.consumption.percentages.牛肉 = 501;
  delete record.consumption.consumedGrams.牛肉;
  const { tables } = core.buildTables([record], {}, library);
  assert.equal(tables.textures[0].value_source, 'missing');
  assert.equal(tables.textures[0].hardness_gf, undefined);
  assert.equal(tables.ingredients[0].consumed_percent, '');
  assert.match(tables.ingredients[0].issues, /invalid_consumed_percent/);
  assert.match(tables.ingredients[0].issues, /completed_evaluation_missing_values/);
});

test('匹配快照和摄入量不一致时保留原值并报告，不擅自修正', () => {
  const record = sample()[0];
  record.selectedRecords = { 牛肉: 't99' };
  record.consumption.consumedGrams.牛肉 = 80;
  const { tables } = core.buildTables([record], {}, library);
  assert.equal(tables.ingredients[0].consumed_g, 80);
  assert.match(tables.ingredients[0].issues, /selection_snapshot_mismatch/);
  assert.match(tables.ingredients[0].issues, /consumption_weight_mismatch/);
  assert.match(tables.meals[0].issues, /consumption_total_mismatch/);
});

test('CSV中文BOM、逗号引号换行正确转义，文本公式防护不改变负数', () => {
  const content = core.csv([{ key: 'x' }], [{ x: '中文,"双引号"\n换行' }, { x: '=1+1' }, { x: ' @SUM(A1)' }, { x: -0.3 }, { x: '001207' }, { x: 0 }, { x: null }]);
  assert.ok(content.startsWith('\uFEFF'));
  assert.ok(content.includes('"中文,""双引号""\n换行"'));
  assert.ok(content.includes('"\'=1+1"'));
  assert.ok(content.includes('"\' @SUM(A1)"'));
  assert.ok(content.includes('"-0.3"'));
  assert.ok(content.includes('"001207"'));
  assert.ok(content.endsWith('"0"\r\n""\r\n'));
});

test('CLI端到端生成三表、字典及校验摘要，连续导出不会覆盖', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-export-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const cli = path.join(core.ROOT, 'scripts/export-meals.cjs');
  for (let i = 0; i < 2; i++) {
    const result = spawnSync(process.execPath, [cli, '--input', samplePath, '--out', temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const directories = fs.readdirSync(temp);
  assert.equal(directories.length, 2);
  const output = path.join(temp, directories[0]);
  assert.deepEqual(fs.readdirSync(output).sort(), ['fields.csv', 'ingredients.csv', 'manifest.json', 'meals.csv', 'textures.csv']);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  assert.equal(manifest.summary.exportedRecords, 4);
  assert.match(manifest.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.textureLibrarySha256, library.sha256);
  const invalid = spawnSync(process.execPath, [cli, '--invalid'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /未知参数/);
});

test('超过小程序分页条数的输入会全部导出，空集合仍有表头', () => {
  const records = Array.from({ length: 125 }, (_, i) => ({ ...sample()[1], _id: `large-${i}` }));
  assert.equal(core.buildTables(records, {}, library).tables.meals.length, 125);
  assert.equal(core.buildTables([], {}, library).summary.exportedRecords, 0);
});

test('云导出按真实CLI响应协议验证状态、失败数及下载条数', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-cloud-export-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const runner = async (args) => {
    assert.deepEqual(args.slice(0, 6), ['db', 'nosql', 'dump', 'meal_records', '--file-type', 'json']);
    assert.equal(args.at(-1), '--json');
    const raw = args[args.indexOf('--output-dir') + 1];
    const filename = path.join(raw, 'download.json');
    fs.copyFileSync(samplePath, filename);
    return JSON.stringify({ data: { status: 'success', path: filename, recordSuccess: 5, recordFail: 0, jobId: 123 } });
  };
  const result = await downloadAndExport({ envId: 'test-env', out: temp, completedOnly: true }, runner);
  assert.equal(result.summary.inputRecords, 5);
  assert.equal(result.summary.exportedRecords, 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(result.output, 'cloud-export.json'))).jobId, 123);
  const raw = path.join(result.output, 'raw');
  const response = (extra) => JSON.stringify({ data: { status: 'success', path: path.join(raw, 'download.json'), recordSuccess: 5, recordFail: 0, ...extra } });
  assert.throws(() => parseDownloadResult(response({ recordFail: 1 }), raw), /失败记录/);
  assert.throws(() => parseDownloadResult(response({ recordSuccess: 6 }), raw), /云端报告/);
  assert.throws(() => parseDownloadResult(response({ status: 'running' }), raw), /未确认/);
  assert.throws(() => parseDownloadResult(response({ path: samplePath }), raw), /不在本次/);
  assert.throws(() => parseDownloadResult(response({ recordFail: undefined }), raw), /计数/);
  assert.throws(() => parseDownloadResult(response({ recordFail: '' }), raw), /计数/);
});

test('云端确认的空集合可导出，其他空文件仍报错', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-cloud-empty-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const filename = path.join(temp, 'empty.json');
  fs.writeFileSync(filename, '');
  parseDownloadResult(JSON.stringify({ data: { status: 'success', path: filename, recordSuccess: 0, recordFail: 0 } }), temp);
  assert.deepEqual(core.parseRecords(fs.readFileSync(filename, 'utf8')), []);
});
