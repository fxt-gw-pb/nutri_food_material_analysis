import { ConfidenceLevel } from '../types/index';

// 可信度文案：统一使用 较高 / 中等 / 较低 三档。
const LABELS: Record<ConfidenceLevel, string> = {
  high: '较高',
  medium: '中等',
  low: '较低',
};

export function confidenceLabel(level: ConfidenceLevel): string {
  return LABELS[level] || '中等';
}
