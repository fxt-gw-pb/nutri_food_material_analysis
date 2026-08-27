import { MealAnalysis } from '../types/index';
import { MOCK_DISH_SETS } from './dishes';

// 首次启动注入的示例历史记录，让历史页与详情页在无真实数据时也能演示。
// 接入 CloudBase 后这些数据不再产生，历史改由云数据库 meal_records 提供。
export function buildSeedHistory(): MealAnalysis[] {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const clone = (i: number) =>
    JSON.parse(JSON.stringify(MOCK_DISH_SETS[i])) as MealAnalysis['dishes'];

  return [
    {
      analysisId: 'seed_meal_1',
      imageFileId: undefined,
      imageUrl: '',
      status: 'completed',
      mealType: 'lunch',
      modelName: 'qwen-vl-mock',
      promptVersion: 'mock-v0',
      dishes: clone(1),
      selections: [],
      createdAt: now - day,
      updatedAt: now - day,
    },
    {
      analysisId: 'seed_meal_2',
      imageFileId: undefined,
      imageUrl: '',
      status: 'completed',
      mealType: 'dinner',
      modelName: 'qwen-vl-mock',
      promptVersion: 'mock-v0',
      dishes: clone(2),
      selections: [],
      createdAt: now - 3 * day,
      updatedAt: now - 3 * day,
    },
  ];
}
