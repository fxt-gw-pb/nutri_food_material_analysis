import { Dish } from '../types/index';

// 模拟「视觉模型识别结果」（只有菜名 / 烹饪方式 / 原食材，没有重量）。
// 一次识别只出一道菜。createMealAnalysis 按顺序轮换选取，用来演练三种匹配路径：
//   1 → 菜名与库中一致，且该菜测了两种原食材（火腿丝 / 豆腐丝）；
//   2 → 菜名与库中一致，整菜取样只有一行数据；
//   3 → 库里没有这道菜，靠原食材找最像的一道菜。
export const MOCK_DISHES: Dish[] = [
  {
    dishName: '大煮干丝',
    cookingMethod: '煮',
    recognitionConfidence: 'high',
    ingredients: [
      { name: '豆腐丝', cookingMethod: '煮' },
      { name: '火腿丝', cookingMethod: '煮' },
    ],
  },
  {
    dishName: '清蒸石斑鱼',
    cookingMethod: '蒸',
    recognitionConfidence: 'high',
    ingredients: [{ name: '石斑鱼', cookingMethod: '蒸' }],
  },
  {
    dishName: '白灼基围虾',
    cookingMethod: '煮',
    recognitionConfidence: 'medium',
    ingredients: [{ name: '基围虾', cookingMethod: '煮' }],
  },
];
