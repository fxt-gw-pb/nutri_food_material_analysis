#!/usr/bin/env node
const path = require('node:path');
const { parseArgs } = require('node:util');
const { ROOT } = require('./export/core.cjs');
const { exportSingleFile } = require('./export/single.cjs');
try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) console.log('只生成一个合并CSV：\n  npm run export:single -- --input records.json --output exports/全部数据.csv\n一食材一行，无菜品/食材的记录也保留；原始字段、评估、切割/下压指标、全部匹配及备选均在同一文件。');
  else {
    const input = path.resolve(values.input || path.join(ROOT, 'exports/input/meal_records.json'));
    const output = path.resolve(values.output || path.join(ROOT, `exports/全部数据_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`));
    console.log(JSON.stringify(exportSingleFile(input, output), null, 2));
  }
} catch (error) { console.error(`单表导出失败：${error.message}`); process.exitCode = 1; }
