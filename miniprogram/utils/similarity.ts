// 中文短文本相似度（菜名 / 食材名匹配用）。
// 纯本地计算，不依赖任何模型：字级 + 二元组 Dice 系数，再对「丝片块丁」这类
// 刀工后缀做一次归一化重算，取最高分。
//
// 性能注意：一次匹配要跑上千次比较，而 normalize / coreWord 里都是正则。
// 因此对「库中固定不变的名字」应当先用 prepare() 预处理一次，之后走
// similarityPrepared()，避免每次匹配都把整库的名字重新正则一遍。

/** 归一化：去掉空白、标点与常见修饰词，只留下参与比较的汉字/字母/数字 */
export function normalize(text: string): string {
  return String(text || '')
    .replace(/[\s　]+/g, '')
    .replace(/[（）()【】\[\]「」《》·、,，。.:：;；!！?？"'`~-]/g, '')
    .toLowerCase();
}

/** 刀工 / 形态后缀：比较「豆腐丝」与「豆腐」、「虾仁」与「鲜虾」时先剥掉。
 *  只收真正表示形态的字——像「花」「皮」会把「菜花」削成「菜」，反而误伤，故不收。 */
const CUT_SUFFIX = /(丝|片|块|丁|段|条|末|粒|泥|仁)$/;

/** 烹饪器具词：质构库里有「鸭肉高压锅」「高压锅胡萝卜」这类把器具粘进食材名的写法，
 *  它描述的是怎么做而不是这是什么，比较食材时先剥掉，否则「鸭肉」会匹配不上「鸭肉高压锅」。 */
const DEVICE_WORDS = /(高压锅|电压力锅|空气炸锅|电饭煲|微波炉|烤箱|砂锅)/g;

/** 提取核心词：剥掉器具词与刀工后缀（后缀最多剥两层，如「五花肉片」→「五花肉」） */
export function coreWord(text: string): string {
  const base = normalize(text);
  let s = base.replace(DEVICE_WORDS, '') || base;
  for (let i = 0; i < 2; i += 1) {
    const next = s.replace(CUT_SUFFIX, '');
    if (next === s || next.length < 1) break;
    s = next;
  }
  return s || base;
}

/** 预处理过的名字：归一化形 + 去刀工后缀的核心形 */
export interface Prepared {
  norm: string;
  core: string;
}

export function prepare(text: string): Prepared {
  // 花生米与花生仁是同一种可食部分；「新鲜」只是状态修饰。
  // 不把花生芽归并进来，芽菜的质构与花生仁不同。
  const original = normalize(text);
  const withoutFreshness = original.replace(/^新鲜(?=花生仁$)/, '');
  const norm = /^(花生米|花生粒)$/.test(withoutFreshness) ? '花生仁' : withoutFreshness;
  return { norm, core: coreWord(norm) };
}

/** 公共后缀长度：中文食材名的尾字往往就是品类（虾 / 鱼 / 蛋 / 豆腐） */
function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) {
    n += 1;
  }
  return n;
}

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i += 1) {
    out.push(s.slice(i, i + 2));
  }
  return out;
}

/** 两个字符串数组的 Dice 系数 */
function dice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts: Record<string, number> = {};
  a.forEach((x) => {
    counts[x] = (counts[x] || 0) + 1;
  });
  let hit = 0;
  b.forEach((x) => {
    const c = counts[x] || 0;
    if (c > 0) {
      counts[x] = c - 1;
      hit += 1;
    }
  });
  return (2 * hit) / (a.length + b.length);
}

function rawSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // 一方完全包含另一方（如「虾仁」⊂「韭菜虾仁」），给一个偏高的基准分。
  const contain =
    a.indexOf(b) >= 0 || b.indexOf(a) >= 0
      ? Math.min(a.length, b.length) / Math.max(a.length, b.length)
      : 0;
  const uni = dice(a.split(''), b.split(''));
  const bi = dice(bigrams(a), bigrams(b));
  // 二元组更能体现词序，权重高一些；单字保证「虾仁 / 鲜虾」这类也能捞回来。
  return Math.max(contain, 0.6 * bi + 0.4 * uni);
}

/** 综合相似度（输入已预处理）。范围 0–1 */
export function similarityPrepared(a: Prepared, b: Prepared): number {
  if (!a.norm || !b.norm) return 0;
  if (a.norm === b.norm) return 1;
  // 同品类加成：「基围虾」和「鲜虾」字面几乎不重合，但尾字同为「虾」，
  // 按需求「食材优先」的原则，这类应当能被捞成相似备选。
  const suffix = commonSuffixLength(a.core, b.core);
  const suffixScore = suffix > 0 ? Math.min(0.75, 0.45 + 0.15 * suffix) : 0;
  return Math.max(
    rawSimilarity(a.norm, b.norm),
    rawSimilarity(a.core, b.core) * 0.98,
    suffixScore,
  );
}

/** 综合相似度（原始字符串）。范围 0–1 */
export function similarity(a: string, b: string): number {
  return similarityPrepared(prepare(a), prepare(b));
}
