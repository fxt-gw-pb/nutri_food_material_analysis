import { Dish } from '../types/index';

// 模拟「视觉模型识别结果」（只有菜名 / 烹饪方式 / 全部食材，没有重量）。
// 一次识别只出一道菜。createMealAnalysis 按顺序轮换选取，用来演练三条匹配路径：
//   1 → 菜名与库中一致、三种食材各自都能对上，且每种食材都有 6/12 分钟两个版本
//        （用来验证「多个烹饪时间取最长」这条规则，页面应显示 12 分钟）；
//   2 → 该食材切割测试与下压测试都做过，结果页应并列展示两组读数；
//   3 → 库里没有这道菜，靠逐食材去全库找最接近的实测数据。
export const MOCK_DISHES: Dish[] = [
  {
    dishName: '粉丝鲜虾煲',
    cookingMethod: '炖',
    recognitionConfidence: 'high',
    ingredients: [
      { name: '鲜虾', cookingMethod: '炖' },
      { name: '粉丝', cookingMethod: '炖' },
      { name: '白菜丝', cookingMethod: '炖' },
    ],
  },
  {
    dishName: '五香酱牛肉',
    cookingMethod: '卤',
    recognitionConfidence: 'high',
    ingredients: [{ name: '牛腱子肉', cookingMethod: '卤' }],
  },
  {
    dishName: '青椒土豆丝炒肉',
    cookingMethod: '炒',
    recognitionConfidence: 'medium',
    ingredients: [
      { name: '土豆丝', cookingMethod: '炒' },
      { name: '青椒', cookingMethod: '炒' },
      { name: '猪里脊肉', cookingMethod: '炒' },
    ],
  },
];
