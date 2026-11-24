#!/usr/bin/env node
const path = require('node:path');
const { ROOT, validateOptions, exportFile } = require('./export/core.cjs');

const HELP = `识别数据导出（在项目根目录运行，Node.js 18+）

  npm run export:data -- --input exports/input/meal_records.json
  npm run export:data -- --input records.json --from 2026-09-01 --to 2026-09-30
  npm run export:data -- --input records.json --participant 001207 --completed-only

选项：
  --input 路径        完整 JSON / JSONL；默认 exports/input/meal_records.json
  --out 目录          输出父目录；每次创建新子目录，默认 exports/runs
  --from YYYY-MM-DD    按创建日期筛选，UTC+08:00，包含当天
  --to YYYY-MM-DD      按创建日期筛选，UTC+08:00，包含当天
  --participant 编码  精确匹配，保留前导零
  --completed-only    仅导出已完成饭后评估的记录
  --all-records       包含作废、失败、处理中记录（默认只含有效识别）
  --include-excluded  包含被用户删除的食材，excluded=1
  --help              查看说明

输出：meals.csv / ingredients.csv / textures.csv / fields.csv / manifest.json
默认保留未评估记录并标明状态；缺失数值留空，不重新估重。
Excel 请通过「数据 → 从文本/CSV」导入，参与者编码列设为文本。
云端直接导出：npm run export:cloud -- --help
`;
function parseArgs(args, cloud = false) {
  const options = {};
  const values = new Map([['--input', 'input'], ['--out', 'out'], ['--from', 'from'], ['--to', 'to'], ['--participant', 'participant']]);
  if (cloud) { values.delete('--input'); values.set('--env-id', 'envId'); }
  const flags = new Map([['--all-records', 'allRecords'], ['--include-excluded', 'includeExcluded'], ['--completed-only', 'completedOnly'], ['--help', 'help']]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flags.has(arg)) options[flags.get(arg)] = true;
    else if (values.has(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw Error(`${arg} 缺少参数值`);
      options[values.get(arg)] = value;
    } else throw Error(`未知参数：${arg}；用 --help 查看用法`);
  }
  validateOptions(options);
  return options;
}
function report({ output, summary }) {
  console.log(`导出完成：${output}`);
  console.log(`输入 ${summary.inputRecords} 条，输出 ${summary.exportedRecords} 条识别 / ${summary.ingredientRows} 条食材 / ${summary.textureRows} 条质构测试。`);
  console.log(`筛掉：状态 ${summary.skippedStatus} 条、评估 ${summary.skippedEvaluation} 条、参与者 ${summary.skippedParticipant} 条、日期 ${summary.skippedDate} 条、日期缺失 ${summary.skippedInvalidDate} 条。`);
  if (Object.keys(summary.issueCounts).length) console.log('存在缺失或不一致数据，请查看 meals.csv / ingredients.csv 的 issues 列及 manifest.json。');
  if (!summary.exportedRecords) console.log('本次没有符合条件的记录，CSV 仅含表头。');
}
if (require.main === module) {
  try {
    const { input, help, ...options } = parseArgs(process.argv.slice(2));
    if (help) console.log(HELP);
    else report(exportFile(path.resolve(input || path.join(ROOT, 'exports/input/meal_records.json')), options));
  } catch (error) { console.error(`导出失败：${error.message}`); process.exitCode = 1; }
}
module.exports = { parseArgs, report, HELP };
