#!/usr/bin/env node
const path = require('node:path');
const { parseArgs } = require('node:util');
const { ROOT } = require('./export/core.cjs');
const { exportFullFile } = require('./export/full.cjs');
try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) console.log('完整导出（保留所有记录/食材、多道菜及旧版评估，并补充当前质构匹配）：\n  npm run export:full -- --input exports/input/meal_records.json\n  可用 --out 指定输出父目录。每次新建目录，原始JSON随结果备份。');
  else console.log(JSON.stringify(exportFullFile(path.resolve(values.input || path.join(ROOT, 'exports/input/meal_records.json')), values), null, 2));
} catch (error) { console.error(`完整导出失败：${error.message}`); process.exitCode = 1; }
