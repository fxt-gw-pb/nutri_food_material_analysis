import { CONFIG } from './config';
import { normalizeParticipantCode } from './userProfile';
import { QUESTIONNAIRE_VERSION } from '../data/questionnaire';
import { QuestionnaireDraft } from '../types/questionnaire';
import { validateQuestionnaireAnswers } from '../utils/questionnaire';

function key(code: string): string {
  return `questionnaire_draft_${CONFIG.useCloud ? CONFIG.cloudEnv : 'mock'}_${QUESTIONNAIRE_VERSION}_${encodeURIComponent(normalizeParticipantCode(code))}`;
}

export function getQuestionnaireDraft(code: string): QuestionnaireDraft | null {
  const value = wx.getStorageSync(key(code)) as QuestionnaireDraft | '' | null;
  if (!value) return null;
  if (value.participantCode !== normalizeParticipantCode(code) || value.questionnaireVersion !== QUESTIONNAIRE_VERSION ||
      typeof value.submissionId !== 'string' || !/^q_[a-z0-9_]{12,77}$/.test(value.submissionId) ||
      typeof value.pending !== 'boolean') throw new Error('问卷草稿读取失败，请重试');
  return { ...value, answers: validateQuestionnaireAnswers(value.answers, value.pending) };
}

export function saveQuestionnaireDraft(draft: QuestionnaireDraft): void {
  // 存储失败向页面报告，避免把“已保存”展示给用户。
  wx.setStorageSync(key(draft.participantCode), draft);
}

export function clearQuestionnaireDraft(code: string): void {
  wx.removeStorageSync(key(code));
}
