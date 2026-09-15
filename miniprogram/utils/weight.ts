// ============================================================================
// 重量估算（纯本地计算）。
//
// 为什么不直接用模型给的克数：视觉模型对「几克」没有可靠的直觉，照片里也没有
// 任何绝对尺度——同一盘菜拍近拍远，像素面积能差好几倍。所以拍照时要用户选餐盘
// 直径，这是整张图里唯一已知的真实长度，一切换算都以它为基准。
//
// 算法：
//   盘面积 = π(d/2)²                       ← 由用户选的直径得到，真实 cm²
//   食材体积 = 盘面积 × 该食材盘面占比 × 平均堆叠厚度
//   重量 = 体积 × 堆积密度
//
// 这里用的是**堆积密度**（bulk density，连缝隙一起算的整堆密度），不是材料密度，
// 所以不需要再单独乘一个空隙系数——切丝的菜堆得松、整块肉堆得实，这个差别已经
// 体现在密度表里了。两套系数相乘容易重复打折，反而更不准。
//
// 模型的直接估重（grams）不丢弃，作为交叉校验：两条路线取**加权**几何平均。
// 权重偏向几何路线（0.7 : 0.3）——直估对绝对尺度基本不敏感（模型看不出盘子多大），
// 等权混合会把餐盘直径这个唯一的真实标尺稀释掉一半，白费了让用户选盘径的功夫。
// 只有当两条路线差到 4 倍以上、说明至少有一条明显失灵时，才退回等权对冲。
// ============================================================================

import { ConfidenceLevel } from '../types/index';

/** 常见餐盘直径选项（cm） */
export const PLATE_DIAMETER_OPTIONS = [20, 22, 24, 26, 28];
/** 默认餐盘直径（cm）——家用中式菜盘的常见尺寸 */
export const DEFAULT_PLATE_DIAMETER = 26;
/** 允许的直径范围，超出视为输入有误 */
export const MIN_PLATE_DIAMETER = 10;
export const MAX_PLATE_DIAMETER = 60;

/**
 * 堆积密度表（g/cm³）：这一堆食材连缝隙一起算的密度。
 * 关键词按**先长后短**匹配食材名，命中即用。
 * 数值取自常见食材的容重经验值，用于量级估算，不是精确物性数据。
 */
const DENSITY_KEYWORDS: { keys: string[]; density: number }[] = [
  // 液体与半流体：几乎没有空隙
  { keys: ['汤', '羹', '卤汁', '酱汁'], density: 1.0 },
  { keys: ['粥'], density: 0.95 },
  { keys: ['泥', '糊', '馅'], density: 0.95 },
  // 主食
  { keys: ['米饭', '饭'], density: 0.8 },
  { keys: ['粉丝', '米粉', '河粉', '面条', '挂面', '拉面', '面'], density: 0.65 },
  { keys: ['馒头', '花卷', '面包', '蛋糕', '发糕'], density: 0.4 },
  { keys: ['饺子', '包子', '烧麦', '馄饨'], density: 0.6 },
  // 蛋与豆制品
  { keys: ['豆腐'], density: 1.02 },
  { keys: ['腐竹', '豆皮', '豆干', '豆结'], density: 0.8 },
  { keys: ['鸡蛋', '鸭蛋', '鹅蛋', '蛋'], density: 1.0 },
  // 水产
  { keys: ['虾仁'], density: 0.9 },
  { keys: ['大虾', '基围虾', '鲜虾', '虾', '蟹', '贝', '螺', '蛤'], density: 0.55 },
  { keys: ['鱿鱼', '章鱼', '海参'], density: 0.9 },
  { keys: ['鱼'], density: 1.0 },
  // 肉
  { keys: ['肉馅', '丸子', '肉丸'], density: 0.95 },
  { keys: ['排骨', '肋排', '猪蹄', '鸡翅', '鸡腿', '鸭腿', '骨'], density: 0.7 },
  { keys: ['肉丝', '肉片'], density: 0.7 },
  { keys: ['五花肉', '里脊', '腱子', '梅花肉', '肘', '肉'], density: 0.85 },
  // 蔬菜：叶菜蓬松、根茎密实，差别很大
  { keys: ['菜叶', '白菜', '菠菜', '生菜', '油菜', '青菜', '韭菜', '芹菜', '苋菜'], density: 0.35 },
  { keys: ['豆芽', '金针菇', '香菇', '菌', '菇', '木耳'], density: 0.45 },
  { keys: ['土豆', '胡萝卜', '山药', '芋', '藕', '萝卜', '红薯', '笋'], density: 0.8 },
  { keys: ['冬瓜', '南瓜', '黄瓜', '苦瓜', '丝瓜', '茄子'], density: 0.75 },
  { keys: ['西红柿', '番茄', '青椒', '辣椒', '洋葱', '蒜苔', '豆角', '豌豆', '毛豆'], density: 0.6 },
  { keys: ['海带', '紫菜'], density: 0.7 },
];

/** 质构库菜品类别 → 兜底堆积密度 */
const DENSITY_BY_CATEGORY: Record<string, number> = {
  肉类菜肴: 0.82,
  海鲜类菜肴: 0.75,
  蔬菜类菜肴: 0.5,
  主食类: 0.7,
  蛋类及豆制品类菜肴: 0.95,
  甜品点心类: 0.6,
  水果: 0.7,
};

/** 什么都没命中时的密度：取全表的中位量级 */
const DEFAULT_DENSITY = 0.75;

/** 按食材名（其次按类别）取堆积密度 */
export function bulkDensity(name: string, category?: string): number {
  const n = String(name || '');
  for (let i = 0; i < DENSITY_KEYWORDS.length; i += 1) {
    const entry = DENSITY_KEYWORDS[i];
    for (let j = 0; j < entry.keys.length; j += 1) {
      if (n.indexOf(entry.keys[j]) >= 0) return entry.density;
    }
  }
  if (category && DENSITY_BY_CATEGORY[category]) return DENSITY_BY_CATEGORY[category];
  return DEFAULT_DENSITY;
}

/** 模型给出的、用于估重的几何量 */
export interface WeightInput {
  /** 食材名（用于查密度） */
  name: string;
  /** 匹配到的质构记录类别，密度兜底用 */
  category?: string;
  /** 该食材占盘面的面积比例 0–1 */
  areaRatio?: number;
  /** 平均堆叠厚度 cm */
  heightCm?: number;
  /** 模型直接给的克数，用作交叉校验 */
  grams?: number;
  /** 模型对自己估重的信心 */
  confidence?: ConfidenceLevel;
}

export const WEIGHT_ALGORITHM_VERSION = '2026-09-15-meat-half';

/** 按识别食材本身校正，不能因配菜匹配到肉类菜肴就一起减半。 */
export function meatCorrectionFactor(name: string): number {
  if (/素肉|植物肉|人造肉|仿肉|鱼|虾|蟹|贝|螺|蛤|蛋|鸡腿菇|鸡毛菜|羊肚菌|猪肚菇|鸡枞|猴头菇|肉桂|肉豆蔻|果肉|椰肉|桂圆|龙眼/.test(name)) return 1;
  return /猪|牛肉|牛腩|牛腱|牛筋|牛肚|牛百叶|牛舌|牛排|牛柳|牛杂|牛肝|牛心|肥牛|羊|鸡|鸭|鹅|兔|五花|里脊|腱子|梅花肉|排骨|肋排|肘|火腿|培根|香肠|腊肠|腊肉|午餐肉|肉块|肉丝|肉片|肉丁|肉末|肉沫|肉馅|肉丸|瘦肉|肥肉|红烧肉|扣肉|回锅肉/.test(name) || /肉$/.test(name) ? 0.5 : 1;
}

export interface WeightEstimate {
  /** 最终估重（整数 g）；无法估算时为 0 */
  grams: number;
  minG: number;
  maxG: number;
  confidence: ConfidenceLevel;
  /** 用到的堆积密度，后台审计解释用 */
  density: number;
  /** 一句话说明这个数是怎么来的 */
  basis: string;
}

const LEVELS: ConfidenceLevel[] = ['high', 'medium', 'low'];
function downgrade(level: ConfidenceLevel): ConfidenceLevel {
  const i = LEVELS.indexOf(level);
  return LEVELS[Math.min(LEVELS.length - 1, i < 0 ? 1 : i + 1)];
}

/** 置信度 → 区间半宽比例。估重本就粗糙，区间宁可给宽也别给出虚假的精确 */
const RANGE_RATIO: Record<ConfidenceLevel, number> = {
  high: 0.3,
  medium: 0.45,
  low: 0.6,
};

/** 单份食材的合理上限（g）：再大多半是模型或几何量出错了 */
const MAX_SINGLE_G = 1500;
/** 堆叠厚度上限（cm）：盘子里的菜再高也就这样，超过必是模型看错了 */
const MAX_HEIGHT_CM = 8;
/** 正常情况下几何路线的权重 */
const W_GEOMETRIC = 0.7;
/** 两条路线差异超过这个倍数就退回等权对冲 */
const DISAGREE_RATIO = 4;

/** 取整：50g 以上按 5g 取整，避免「137g」这种假精确 */
function roundWeight(g: number): number {
  if (g <= 0) return 0;
  if (g < 50) return Math.max(1, Math.round(g));
  return Math.round(g / 5) * 5;
}

/**
 * 估算一种食材的重量。
 * plateDiameterCm 是整张图唯一的真实尺度，没有它就只能退回模型直估。
 */
export function estimateWeight(input: WeightInput, plateDiameterCm: number): WeightEstimate {
  const density = bulkDensity(input.name, input.category);
  let confidence: ConfidenceLevel = input.confidence || 'medium';

  const areaRatio = clamp(input.areaRatio || 0, 0, 1);
  const heightCm = clamp(input.heightCm || 0, 0, MAX_HEIGHT_CM);
  const diameter = clamp(plateDiameterCm || 0, 0, MAX_PLATE_DIAMETER);
  const direct = input.grams && isFinite(input.grams) && input.grams > 0 ? input.grams : 0;

  let geometric = 0;
  if (diameter >= MIN_PLATE_DIAMETER && areaRatio > 0 && heightCm > 0) {
    const radius = diameter / 2;
    const plateArea = Math.PI * radius * radius; // cm²
    const volume = plateArea * areaRatio * heightCm; // cm³
    geometric = volume * density;
  }

  let grams: number;
  let basis: string;
  if (geometric > 0 && direct > 0) {
    const ratio = Math.max(geometric, direct) / Math.min(geometric, direct);
    const disagree = ratio > DISAGREE_RATIO;
    // 用几何平均而不是算术平均：两条路线量级差得远时，几何平均不会被大的那个拖走。
    // 正常偏向几何路线；差得离谱时说明至少有一条失灵，退回等权对冲更稳妥。
    const w = disagree ? 0.5 : W_GEOMETRIC;
    grams = Math.exp(w * Math.log(geometric) + (1 - w) * Math.log(direct));
    basis =
      `按 ${diameter}cm 餐盘换算约 ${Math.round(geometric)}g，模型直接估 ${Math.round(direct)}g，` +
      `以前者为主加权合成（堆积密度 ${density} g/cm³）`;
    if (disagree) {
      confidence = downgrade(confidence);
      basis += '；两种算法差异较大，结果仅供参考';
    }
  } else if (geometric > 0) {
    grams = geometric;
    basis = `按 ${diameter}cm 餐盘换算（占盘面 ${Math.round(areaRatio * 100)}%、厚约 ${heightCm}cm、堆积密度 ${density} g/cm³）`;
  } else if (direct > 0) {
    grams = direct;
    confidence = downgrade(confidence);
    basis = '缺少可用的几何信息，只能采用模型的直接估计';
  } else {
    return { grams: 0, minG: 0, maxG: 0, confidence: 'low', density, basis: '无法估算重量' };
  }

  grams = Math.min(grams, MAX_SINGLE_G);
  const r = RANGE_RATIO[confidence];
  const factor = meatCorrectionFactor(input.name);
  if (factor === 0.5) basis += '；按 0915 使用反馈，肉类估重及区间统一乘 0.5';
  return {
    grams: roundWeight(grams) * factor,
    minG: roundWeight(grams * (1 - r)) * factor,
    maxG: roundWeight(grams * (1 + r)) * factor,
    confidence,
    density,
    basis,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (!isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/** 「约 120 g（85–155 g）」这样的展示文案 */
export function weightText(w: WeightEstimate): string {
  if (!w.grams) return '重量未估出';
  return `约 ${w.grams} g`;
}

export function weightRangeText(w: WeightEstimate): string {
  if (!w.grams) return '';
  return `${w.minG}–${w.maxG} g`;
}

/** 校正用户输入的餐盘直径，非法值回落到默认值 */
export function normalizePlateDiameter(value: unknown): number {
  const n = Number(value);
  if (!isFinite(n) || n < MIN_PLATE_DIAMETER || n > MAX_PLATE_DIAMETER) {
    return DEFAULT_PLATE_DIAMETER;
  }
  return Math.round(n * 10) / 10;
}
