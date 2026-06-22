import { Dish } from '../types/index';

// 可复用的模拟菜品数据集。
// createMealAnalysis 会按顺序轮换选取其中一组，使每次分析结果不完全相同。
// 接入真实后端后，这些数据将由云函数 analyzeMeal 的返回结果取代。
export const MOCK_DISH_SETS: Dish[][] = [
  // —— 组 1：示例数据（来自需求文档） ——
  [
    {
      dishId: 'dish_1',
      dishName: '西兰花炒鸡胸肉',
      cookingMethod: '炒',
      estimatedTotalG: 180,
      minTotalG: 130,
      maxTotalG: 240,
      recognitionConfidence: 'medium',
      weightConfidence: 'medium',
      ingredients: [
        { name: '鸡胸肉', estimatedG: 95, minG: 65, maxG: 130, confidence: 'medium' },
        { name: '西兰花', estimatedG: 85, minG: 60, maxG: 115, confidence: 'medium' },
      ],
      limitations: [
        '重量基于餐盘尺度、食物面积和常见份量估算',
        '未对油、盐、酱料进行精确测量',
      ],
    },
  ],

  // —— 组 2：两道菜 ——
  [
    {
      dishId: 'dish_1',
      dishName: '番茄炒蛋',
      cookingMethod: '炒',
      estimatedTotalG: 160,
      minTotalG: 120,
      maxTotalG: 220,
      recognitionConfidence: 'high',
      weightConfidence: 'medium',
      ingredients: [
        { name: '鸡蛋', estimatedG: 90, minG: 60, maxG: 120, confidence: 'medium' },
        { name: '番茄', estimatedG: 70, minG: 45, maxG: 100, confidence: 'medium' },
      ],
      limitations: [
        '重量基于餐盘尺度、食物面积和常见份量估算',
        '未对油、盐、糖、酱料进行精确测量',
      ],
    },
    {
      dishId: 'dish_2',
      dishName: '蒸南瓜',
      cookingMethod: '蒸',
      estimatedTotalG: 130,
      minTotalG: 95,
      maxTotalG: 175,
      recognitionConfidence: 'high',
      weightConfidence: 'medium',
      ingredients: [
        { name: '南瓜', estimatedG: 130, minG: 95, maxG: 175, confidence: 'high' },
      ],
      limitations: [
        '块状食物存在堆叠，体积与重量换算存在误差',
      ],
    },
  ],

  // —— 组 3：主食 + 荤菜 ——
  [
    {
      dishId: 'dish_1',
      dishName: '米饭',
      cookingMethod: '蒸',
      estimatedTotalG: 200,
      minTotalG: 150,
      maxTotalG: 260,
      recognitionConfidence: 'high',
      weightConfidence: 'low',
      ingredients: [
        { name: '米饭', estimatedG: 200, minG: 150, maxG: 260, confidence: 'low' },
      ],
      limitations: [
        '米饭密度与堆叠高度差异较大，重量估算不确定性偏高',
      ],
    },
    {
      dishId: 'dish_2',
      dishName: '红烧排骨',
      cookingMethod: '红烧',
      estimatedTotalG: 220,
      minTotalG: 160,
      maxTotalG: 300,
      recognitionConfidence: 'medium',
      weightConfidence: 'low',
      ingredients: [
        { name: '猪肋排', estimatedG: 220, minG: 160, maxG: 300, confidence: 'low' },
      ],
      limitations: [
        '带骨食材的可食部分占比无法从图像精确判断',
        '未对油、盐、酱料进行精确测量',
      ],
    },
  ],
];
