import { MealAnalysis } from '../types/index';
import { MOCK_DISH_SETS } from './dishes';
import { computeConsumption } from '../utils/weight';

// 首次启动注入的示例历史记录，让历史页与详情页在无真实数据时也能演示。
// 接入 CloudBase 后删除此文件，历史改由云数据库 meal_records 提供。
export function buildSeedHistory(): MealAnalysis[] {
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // 第二组（番茄炒蛋 + 蒸南瓜），用户吃了 1/2
  const setB = JSON.parse(JSON.stringify(MOCK_DISH_SETS[1])) as MealAnalysis['dishes'];
  // 第三组（米饭 + 红烧排骨），用户吃了 3/4
  const setC = JSON.parse(JSON.stringify(MOCK_DISH_SETS[2])) as MealAnalysis['dishes'];

  return [
    {
      analysisId: 'seed_meal_1',
      imageFileId: undefined,
      imageUrl: '',
      plateDiameterCm: 26,
      status: 'completed',
      modelName: 'qwen-vl-mock',
      promptVersion: 'mock-v0',
      dishes: setB,
      consumptions: setB.map((d) => computeConsumption(d, 0.5)),
      createdAt: now - day,
      updatedAt: now - day,
    },
    {
      analysisId: 'seed_meal_2',
      imageFileId: undefined,
      imageUrl: '',
      plateDiameterCm: 24,
      status: 'completed',
      modelName: 'qwen-vl-mock',
      promptVersion: 'mock-v0',
      dishes: setC,
      consumptions: setC.map((d) => computeConsumption(d, 0.75)),
      createdAt: now - 3 * day,
      updatedAt: now - 3 * day,
    },
  ];
}
