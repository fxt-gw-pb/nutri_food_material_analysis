import { Dish } from '../types/index';

// 模拟「视觉模型识别结果」的数据集（只有菜名 / 烹饪方式 / 原食材，没有重量）。
// createMealAnalysis 会按顺序轮换选取其中一组，用来在无云端时演练三种匹配路径：
//   组 1 → 菜名与库中一致，走第一步「菜名匹配」；
//   组 2 → 菜名一致，且是单食材菜；
//   组 3 → 库里没有这道菜，走第二步「食材 + 烹饪方式匹配」。
export const MOCK_DISH_SETS: Dish[][] = [
  // —— 组 1：库中有「大煮干丝」（火腿丝 / 豆腐丝，10 与 15 分钟两版） ——
  [
    {
      dishId: 'dish_1',
      dishName: '大煮干丝',
      cookingMethod: '煮',
      recognitionConfidence: 'high',
      ingredients: [
        { name: '豆腐丝', cookingMethod: '煮' },
        { name: '火腿丝', cookingMethod: '煮' },
      ],
    },
  ],

  // —— 组 2：两道单食材菜，库中均有同名菜 ——
  [
    {
      dishId: 'dish_1',
      dishName: '清蒸石斑鱼',
      cookingMethod: '蒸',
      recognitionConfidence: 'high',
      ingredients: [{ name: '石斑鱼', cookingMethod: '蒸' }],
    },
    {
      dishId: 'dish_2',
      dishName: '蒜蓉杭白菜',
      cookingMethod: '炒',
      recognitionConfidence: 'medium',
      ingredients: [{ name: '杭白菜', cookingMethod: '炒' }],
    },
  ],

  // —— 组 3：库中没有这道菜，只能按食材找最相似的 ——
  [
    {
      dishId: 'dish_1',
      dishName: '白灼基围虾',
      cookingMethod: '煮',
      recognitionConfidence: 'medium',
      ingredients: [{ name: '基围虾', cookingMethod: '煮' }],
    },
    {
      dishId: 'dish_2',
      dishName: '家常炖土豆',
      cookingMethod: '炖',
      recognitionConfidence: 'medium',
      ingredients: [{ name: '土豆', cookingMethod: '炖' }],
    },
  ],
];
