import { CONFIG } from './config';
import { normalizeParticipantCode } from './userProfile';
import { QUESTIONNAIRE_TITLE, QUESTIONNAIRE_VERSION } from '../data/questionnaire';
import { QuestionnaireHistory, QuestionnaireRecord, QuestionnaireSubmission } from '../types/questionnaire';
import { questionnaireAnswerItems, validateQuestionnaireAnswers } from '../utils/questionnaire';

const MOCK_KEY = 'questionnaire_responses_mock_v1';
const PAGE_SIZE = 20;

export class QuestionnaireRequestError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

async function request<T>(data: Record<string, unknown>): Promise<T> {
  const response = await wx.cloud.callFunction({ name: CONFIG.questionnaireFunctionName, data });
  const result = response.result as { ok?: boolean; data?: T; message?: string; code?: string } | undefined;
  if (!result || result.ok !== true || !result.data) {
    throw new QuestionnaireRequestError(result?.message || '问卷服务暂不可用，请稍后重试', result?.code || 'UNAVAILABLE');
  }
  return result.data;
}

function mockRecords(): QuestionnaireRecord[] {
  const records = wx.getStorageSync(MOCK_KEY);
  if (!records) return [];
  if (!Array.isArray(records)) throw new Error('本机问卷记录读取失败');
  return records as QuestionnaireRecord[];
}

export async function submitQuestionnaire(input: QuestionnaireSubmission): Promise<QuestionnaireRecord> {
  const submission: QuestionnaireSubmission = {
    ...input, participantCode: normalizeParticipantCode(input.participantCode),
    answers: validateQuestionnaireAnswers(input.answers, true),
  };
  if (submission.questionnaireVersion !== QUESTIONNAIRE_VERSION) throw new Error('问卷版本已更新，请重新进入');
  if (!/^q_[a-z0-9_]{12,77}$/.test(submission.submissionId)) throw new Error('提交编号无效，请重新进入');
  if (CONFIG.useCloud) return request<QuestionnaireRecord>({ action: 'submit', ...submission });
  const records = mockRecords();
  const existing = records.find((record) => record.submissionId === submission.submissionId);
  if (existing) {
    if (existing.participantCode !== submission.participantCode || JSON.stringify(existing.answers) !== JSON.stringify(submission.answers)) {
      throw new Error('本次问卷已提交，请从问卷记录查看');
    }
    return existing;
  }
  const record: QuestionnaireRecord = {
    ...submission, responseId: submission.submissionId, title: QUESTIONNAIRE_TITLE,
    recallPeriod: '最近一周', createdAt: Date.now(), answerItems: questionnaireAnswerItems(submission.answers),
  };
  wx.setStorageSync(MOCK_KEY, [record, ...records]);
  return record;
}

export async function getQuestionnaireHistory(code: string, offset = 0): Promise<QuestionnaireHistory> {
  const participantCode = normalizeParticipantCode(code);
  if (CONFIG.useCloud) return request<QuestionnaireHistory>({ action: 'list', participantCode, offset });
  const records = mockRecords().filter((record) => record.participantCode === participantCode);
  const items = records.slice(offset, offset + PAGE_SIZE);
  return { items, hasMore: records.length > offset + PAGE_SIZE, nextOffset: offset + items.length };
}

export async function getQuestionnaireRecord(responseId: string): Promise<QuestionnaireRecord> {
  if (CONFIG.useCloud) return request<QuestionnaireRecord>({ action: 'get', responseId });
  const record = mockRecords().find((item) => item.responseId === responseId);
  if (!record) throw new Error('问卷记录不存在或无权查看');
  return record;
}
