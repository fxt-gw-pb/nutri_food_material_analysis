// ============================================================================
// 内置质构数据库（只读）。
//
// 数据来源：《500道菜肴质构数据_切割测试_下压测试分类.xlsx》——每条记录是
// 「某道菜里的某种食材」在一次 TPA 全质构测试中的结果，并区分切割 / 下压两种测试模式。
// 原始表格由 scripts/build-texture-db.py 编译成 textureDb.data.ts（紧凑元组），
// 本文件负责把元组还原成带字段名的对象，并建立索引。
//
// 索引有两套：
//   byDish       —— 按菜名，用于「识别出的菜名恰好在库里」时直接取整道菜的数据；
//   byIngredient —— 按归一化食材名，用于逐食材匹配（本小程序的主路径）。
//
// 数据库随小程序包一起下发，匹配全部在本地完成：换菜、看备选都不需要联网。
// ============================================================================

import {
  TEXTURE_CATEGORIES,
  TEXTURE_TEST_MODES,
  TEXTURE_ROWS,
  TextureRow,
} from './textureDb.data';
import { normalize } from '../utils/similarity';

/** 一条 TPA 测试的九项质构指标（原表缺测时为 null） */
export interface TextureMetrics {
  /** 样品高度 mm */
  heightMm: number | null;
  /** 硬度 gf —— 咬断/压下所需的最大力，老年人最关心的指标 */
  hardness: number | null;
  /** 脆度 gf */
  fracturability: number | null;
  /** 黏（着/附）性 gf*sec —— 负值表示黏附，绝对值越大越黏牙 */
  adhesiveness: number | null;
  /** 弹性（无量纲） */
  springiness: number | null;
  /** 咀嚼性 gf —— 嚼碎到可吞咽所需的总功，越大越费劲 */
  chewiness: number | null;
  /** 胶着性 gf */
  gumminess: number | null;
  /** 内聚性（无量纲） */
  cohesiveness: number | null;
  /** 回复性（无量纲） */
  resilience: number | null;
}

/** 数据库中的一条质构记录 */
export interface TextureRecord {
  /** 稳定 id（行号派生），用于在记录里保存用户选中的匹配项 */
  id: string;
  /** 菜品类别，如 肉类菜肴 / 蔬菜类菜肴 */
  category: string;
  /** 菜名 */
  dish: string;
  /** 食材名，如 豆腐丝 / 排骨；整道菜只测一种时等于菜名 */
  ingredient: string;
  /** TPA 测试模式：切割测试 / 下压测试（同一食材可能两种都测过） */
  testMode: string;
  /** 烹饪方式，如 煮 / 蒸 / 红烧；原表未标注时为空串 */
  method: string;
  /** 烹饪时间（分钟），0 表示原表未标注 */
  minutes: number;
  /** 源文件名（原始出处，详情页展示以便溯源） */
  source: string;
  metrics: TextureMetrics;
}

function toRecord(row: TextureRow, index: number): TextureRecord {
  return {
    id: `t${index}`,
    category: TEXTURE_CATEGORIES[row[0]] || '',
    dish: row[1],
    ingredient: row[2],
    testMode: TEXTURE_TEST_MODES[row[5]] || '',
    method: row[3],
    minutes: row[4],
    source: row[15],
    metrics: {
      heightMm: row[6],
      hardness: row[7],
      fracturability: row[8],
      adhesiveness: row[9],
      springiness: row[10],
      chewiness: row[11],
      gumminess: row[12],
      cohesiveness: row[13],
      resilience: row[14],
    },
  };
}

// 解码与建索引都是**懒加载**：小程序启动时不做，第一次真正用到才跑一遍。
// 否则每个 import 了 service 的页面（包括首页）都要在启动路径上白等一次解码。
let cache: {
  records: TextureRecord[];
  byDish: Record<string, TextureRecord[]>;
  byIngredient: Record<string, TextureRecord[]>;
  byId: Record<string, TextureRecord>;
  dishNames: string[];
  ingredientNames: string[];
} | null = null;

function ensure() {
  if (cache) return cache;
  const records = TEXTURE_ROWS.map(toRecord);
  const byDish: Record<string, TextureRecord[]> = {};
  const byIngredient: Record<string, TextureRecord[]> = {};
  const byId: Record<string, TextureRecord> = {};
  const dishNames: string[] = [];
  const ingredientNames: string[] = [];
  records.forEach((rec) => {
    byId[rec.id] = rec;
    if (byDish[rec.dish]) {
      byDish[rec.dish].push(rec);
    } else {
      byDish[rec.dish] = [rec];
      dishNames.push(rec.dish);
    }
    // 食材索引的键用归一化形，这样「土豆 」「土豆」落进同一桶。
    const key = normalize(rec.ingredient);
    if (byIngredient[key]) {
      byIngredient[key].push(rec);
    } else {
      byIngredient[key] = [rec];
      ingredientNames.push(rec.ingredient);
    }
  });
  cache = { records, byDish, byIngredient, byId, dishNames, ingredientNames };
  return cache;
}

/** 全部质构记录 */
export function allRecords(): TextureRecord[] {
  return ensure().records;
}

/** 数据库中出现过的全部菜名 */
export function allDishNames(): string[] {
  return ensure().dishNames;
}

/** 数据库中出现过的全部食材名（每种只出现一次，取首次出现的写法） */
export function allIngredientNames(): string[] {
  return ensure().ingredientNames;
}

/** 某道菜的全部记录（同一道菜可能有多种食材、多个烹饪时长、两种测试模式） */
export function recordsOfDish(dish: string): TextureRecord[] {
  return ensure().byDish[dish] || [];
}

/** 某种食材的全部记录（跨菜；名字按归一化匹配） */
export function recordsOfIngredient(ingredient: string): TextureRecord[] {
  return ensure().byIngredient[normalize(ingredient)] || [];
}

export function findRecordById(id: string): TextureRecord | undefined {
  return ensure().byId[id];
}

// ----------------------------------------------------------------------------
// 面向老年人的通俗解读
// 阈值取自本数据库自身的分位数（硬度五分位、咀嚼性五分位），不是医学标准。
// ----------------------------------------------------------------------------

/** 硬度 gf → 软硬档位文案 */
export function hardnessLabel(hardness: number | null): string {
  if (hardness === null) return '暂无数据';
  if (hardness < 200) return '很软';
  if (hardness < 420) return '偏软';
  if (hardness < 800) return '适中';
  if (hardness < 1600) return '偏硬';
  return '很硬';
}

/** 硬度 gf → 0–100 的条形长度，便于页面画软硬刻度 */
export function hardnessPercent(hardness: number | null): number {
  if (hardness === null || hardness <= 0) return 0;
  // 硬度跨度极大（十几到一万多 gf），用对数刻度才看得出差别。
  const ratio = Math.log(hardness / 10) / Math.log(2000 / 10);
  return Math.max(4, Math.min(100, Math.round(ratio * 100)));
}

/** 咀嚼性 gf → 费劲程度文案 */
export function chewinessLabel(chewiness: number | null): string {
  if (chewiness === null) return '暂无数据';
  if (chewiness < 10) return '很好嚼';
  if (chewiness < 30) return '好嚼';
  if (chewiness < 80) return '一般';
  if (chewiness < 180) return '偏费劲';
  return '很费劲';
}

/** 黏着性 gf*sec → 黏牙程度文案（原表多为负值，取绝对值判断） */
export function adhesivenessLabel(adhesiveness: number | null): string {
  if (adhesiveness === null) return '暂无数据';
  const v = Math.abs(adhesiveness);
  if (v < 2) return '不黏牙';
  if (v < 10) return '略黏牙';
  return '较黏牙';
}

/** 详情页用的九项指标展示行 */
export interface MetricRow {
  label: string;
  unit: string;
  value: string;
}

function fmt(v: number | null): string {
  return v === null ? '—' : String(Math.round(v * 100) / 100);
}

export function metricRows(m: TextureMetrics): MetricRow[] {
  return [
    { label: '样品高度', unit: 'mm', value: fmt(m.heightMm) },
    { label: '硬度', unit: 'gf', value: fmt(m.hardness) },
    { label: '脆度', unit: 'gf', value: fmt(m.fracturability) },
    { label: '黏着性', unit: 'gf·s', value: fmt(m.adhesiveness) },
    { label: '弹性', unit: '', value: fmt(m.springiness) },
    { label: '咀嚼性', unit: 'gf', value: fmt(m.chewiness) },
    { label: '胶着性', unit: 'gf', value: fmt(m.gumminess) },
    { label: '内聚性', unit: '', value: fmt(m.cohesiveness) },
    { label: '回复性', unit: '', value: fmt(m.resilience) },
  ];
}
