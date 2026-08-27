import { MealAnalysis } from '../types/index';
import { MOCK_DISHES } from './dishes';

// 首次启动注入的示例历史记录，让历史页与详情页在无真实数据时也能演示。
// 接入 CloudBase 后这些数据不再产生，历史改由云数据库 meal_records 提供。
export function buildSeedHistory(): MealAnalysis[] {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const clone = (i: number) => JSON.parse(JSON.stringify(MOCK_DISHES[i])) as MealAnalysis['dish'];

  return [
    {
      analysisId: 'seed_meal_1',
      imageFileId: undefined,
      imageUrl: '',
      status: 'completed',
      mealType: 'lunch',
      modelName: 'qwen-vl-mock',
      promptVersion: 'mock-v0',
      dish: clone(0),
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
      dish: clone(2),
      createdAt: now - 3 * day,
      updatedAt: now - 3 * day,
    },
  ];
}
