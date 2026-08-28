import { Dish } from '../types/index';

// 模拟「视觉模型识别结果」（只有菜名 / 烹饪方式 / 全部食材，没有重量）。
// 一次识别只出一道菜。createMealAnalysis 按顺序轮换选取，用来演练三条匹配路径：
//   1 → 菜名与库中一致、三种食材各自都能对上，且每种食材都有 6/12 分钟两个版本
//        （用来验证「多个烹饪时间取最长」这条规则，页面应显示 12 分钟）；
//   2 → 该食材切割测试与下压测试都做过，结果页应并列展示两组读数；
//   3 → 库里没有这道菜，靠逐食材去全库找最接近的实测数据。
// 几何量（areaRatio / heightCm / estimatedG）按真实菜品的合理值填写，
// 让 mock 模式下的估重链路也能跑出像样的数字。
export const MOCK_DISHES: Dish[] = [
  {
    dishName: '粉丝鲜虾煲',
    cookingMethod: '炖',
    recognitionConfidence: 'high',
    weightConfidence: 'medium',
    ingredients: [
      { name: '鲜虾', cookingMethod: '炖', areaRatio: 0.18, heightCm: 1.5, estimatedG: 90 },
      { name: '粉丝', cookingMethod: '炖', areaRatio: 0.3, heightCm: 2, estimatedG: 150 },
      { name: '白菜丝', cookingMethod: '炖', areaRatio: 0.22, heightCm: 1.5, estimatedG: 60 },
    ],
  },
  {
    dishName: '五香酱牛肉',
    cookingMethod: '卤',
    recognitionConfidence: 'high',
    weightConfidence: 'high',
    ingredients: [
      { name: '牛腱子肉', cookingMethod: '卤', areaRatio: 0.35, heightCm: 0.8, estimatedG: 130 },
    ],
  },
  {
    dishName: '青椒土豆丝炒肉',
    cookingMethod: '炒',
    recognitionConfidence: 'medium',
    weightConfidence: 'medium',
    ingredients: [
      { name: '土豆丝', cookingMethod: '炒', areaRatio: 0.35, heightCm: 2, estimatedG: 200 },
      { name: '青椒', cookingMethod: '炒', areaRatio: 0.12, heightCm: 1.5, estimatedG: 40 },
      { name: '猪里脊肉', cookingMethod: '炒', areaRatio: 0.15, heightCm: 1, estimatedG: 70 },
    ],
  },
];
