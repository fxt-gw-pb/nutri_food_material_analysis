import { safeGet } from '../utils/storage';
import { CONFIG } from './config';

interface Draft { percentages: Record<string, number>; updatedAt: number }
function key(id: string): string { return `evaluation_draft_${CONFIG.useCloud ? 'cloud' : 'mock'}_${id}`; }
export function getEvaluationDraft(id: string): Draft | null { return safeGet<Draft | null>(key(id), null); }
export function saveEvaluationDraft(id: string, percentages: Record<string, number>): void {
  wx.setStorageSync(key(id), { percentages, updatedAt: Date.now() });
}
export function clearEvaluationDraft(id: string): void { wx.removeStorageSync(key(id)); }
