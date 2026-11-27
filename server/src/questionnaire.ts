// 随访问卷：对应云函数 questionnaire 的 submit / list / get 三个动作，返回同样的 { ok, data } 结构，
// 前端 questionnaireService.ts 不用改。答案校验直接复用云函数的 validateSubmission（同一份 schema.json）。
import crypto from 'node:crypto';
import { actorKey, assertCode, canAccessCode, Session } from './auth';
import { Doc, Store } from './db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import handler = require('../../cloudfunctions/questionnaire/handler.js');

const PAGE_SIZE = 20;

class InputError extends Error {
  constructor(message: string, public code = 'INVALID_INPUT') { super(message); }
}

function publicRecord(doc: Doc) {
  return { responseId: doc._id, submissionId: doc.submissionId, questionnaireVersion: doc.questionnaireVersion,
    participantCode: doc.participantCode, title: doc.title, recallPeriod: doc.recallPeriod, answers: doc.answers,
    answerItems: doc.answerItems, createdAt: doc.createdAt };
}

function participantCode(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 32) throw new InputError('请填写 1–32 个字符的参与者编号');
  return value.trim();
}

export function questionnaireAction(store: Store, session: Session, event: Record<string, unknown>, now = Date.now) {
  try {
    if (event.action === 'submit') {
      let submission: Record<string, unknown> & { submissionId: string; participantCode: string; questionnaireVersion: string; answers: unknown };
      try {
        submission = handler.validateSubmission(event);
      } catch (err) {
        throw new InputError((err as Error).message, (err as { code?: string }).code || 'INVALID_INPUT');
      }
      assertCode(session, submission.participantCode);
      // 同一参与者的同一次提交只有一个主键：超时重试或并发请求都只存一份，且不改变提交时间。
      const id = 'q_' + crypto.createHash('sha256').update(`web:${submission.participantCode}\n${submission.submissionId}`).digest('hex').slice(0, 30);
      const doc: Doc = { _id: id, _openid: actorKey(session), source: 'web', ...submission, createdAt: now() };
      if (store.insertQuestionnaire(doc)) return { ok: true, data: publicRecord(doc) };
      const existing = store.getQuestionnaire(id);
      if (!existing) throw new Error('问卷写入失败');
      if (existing.participantCode !== submission.participantCode || existing.questionnaireVersion !== submission.questionnaireVersion ||
          JSON.stringify(existing.answers) !== JSON.stringify(submission.answers)) {
        throw new InputError('本次问卷已提交，请从问卷记录查看', 'SUBMISSION_CONFLICT');
      }
      return { ok: true, data: publicRecord(existing) };
    }
    if (event.action === 'list') {
      const code = participantCode(event.participantCode);
      assertCode(session, code);
      const offset = event.offset === undefined ? 0 : event.offset;
      if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > 100000) throw new InputError('分页参数无效');
      const rows = store.listQuestionnaires(code, offset as number, PAGE_SIZE + 1);
      const items = rows.slice(0, PAGE_SIZE).map(publicRecord);
      return { ok: true, data: { items, hasMore: rows.length > PAGE_SIZE, nextOffset: (offset as number) + items.length } };
    }
    if (event.action === 'get') {
      if (typeof event.responseId !== 'string' || !/^q_[a-f0-9]{30}$/.test(event.responseId)) throw new InputError('问卷记录编号无效');
      const doc = store.getQuestionnaire(event.responseId);
      if (!doc || !canAccessCode(session, String(doc.participantCode))) throw new InputError('问卷记录不存在或无权查看', 'NOT_FOUND');
      return { ok: true, data: publicRecord(doc) };
    }
    throw new InputError('不支持的问卷操作');
  } catch (err) {
    if (err instanceof InputError) return { ok: false, code: err.code, message: err.message };
    if (err && (err as { status?: number }).status === 403) return { ok: false, code: 'FORBIDDEN', message: (err as Error).message };
    console.error('[questionnaire] request failed', err);
    return { ok: false, code: 'UNAVAILABLE', message: '问卷服务暂不可用，请稍后重试' };
  }
}
