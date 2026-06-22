// 展示格式化工具。

/** 重量统一展示为整数 g */
export function roundG(value: number): number {
  return Math.round(value);
}

/** 食用比例 → 文案 */
export function ratioLabel(ratio: number): string {
  switch (ratio) {
    case 0.25:
      return '1/4';
    case 0.5:
      return '1/2';
    case 0.75:
      return '3/4';
    case 1:
      return '全吃完';
    default:
      return `${Math.round(ratio * 100)}%`;
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** 时间戳 → YYYY-MM-DD */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 时间戳 → YYYY-MM-DD HH:mm */
export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${formatDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
