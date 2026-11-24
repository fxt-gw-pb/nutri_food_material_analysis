const crypto = require('crypto');
const schema = require('./schema.json');

const COLLECTION = 'questionnaire_responses';
const PAGE_SIZE = 20;

class InputError extends Error {
  constructor(message, code = 'INVALID_INPUT') { super(message); this.code = code; }
}

function participantCode(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 32) {
    throw new InputError('请填写 1–32 个字符的参与者编号');
  }
  return value.trim();
}

function validateSubmission(event) {
  if (event.questionnaireVersion !== schema.version) throw new InputError('问卷版本已更新，请重新进入', 'VERSION_MISMATCH');
  if (typeof event.submissionId !== 'string' || !/^q_[a-z0-9_]{12,77}$/.test(event.submissionId)) {
    throw new InputError('提交编号无效，请重新进入');
  }
  const code = participantCode(event.participantCode);
  const input = event.answers;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((id) => !schema.questions.some((question) => question.id === id))) {
    throw new InputError('问卷答案格式有误');
  }
  const answers = {};
  const answerItems = schema.questions.map((question, index) => {
    const values = input[question.id];
    if (!Array.isArray(values) || values.length === 0 ||
        values.some((value) => !question.options.some((option) => option.value === value)) ||
        new Set(values).size !== values.length || (!question.multiple && values.length !== 1) ||
        (values.length > 1 && question.exclusiveValue && values.includes(question.exclusiveValue))) {
      throw new InputError(`请检查第 ${index + 1} 题的答案`);
    }
    const selected = question.options.filter((option) => values.includes(option.value));
    answers[question.id] = selected.map((option) => option.value);
    return { questionId: question.id, question: question.title,
      values: answers[question.id], labels: selected.map((option) => option.label) };
  });
  return { submissionId: event.submissionId, questionnaireVersion: schema.version,
    participantCode: code, title: schema.title, recallPeriod: '最近一周', answers, answerItems };
}

function publicRecord(doc) {
  return { responseId: doc._id, submissionId: doc.submissionId,
    questionnaireVersion: doc.questionnaireVersion, participantCode: doc.participantCode,
    title: doc.title, recallPeriod: doc.recallPeriod, answers: doc.answers,
    answerItems: doc.answerItems, createdAt: doc.createdAt };
}

function createHandler({ db, getOpenId, now = Date.now }) {
  return async function main(event = {}) {
    try {
      const openid = getOpenId();
      if (typeof openid !== 'string' || !openid) throw new InputError('请在微信小程序中打开问卷', 'UNAUTHENTICATED');
      const collection = db.collection(COLLECTION);
      if (event.action === 'submit') {
        const submission = validateSubmission(event);
        // 同一个微信用户的同一次提交只有一个主键。add 只插入、不覆盖，
        // 即使请求超时后重试或两个请求并发，也只保存一份且不改变提交时间。
        const id = 'q_' + crypto.createHash('sha256').update(`${openid}\n${submission.submissionId}`).digest('hex').slice(0, 30);
        const doc = { _id: id, _openid: openid, ...submission, createdAt: now() };
        try {
          await collection.add({ data: doc });
          return { ok: true, data: publicRecord(doc) };
        } catch (err) {
          // 不把任意写入错误当成功；必须查到相同身份、相同内容的已提交记录。
          const found = await collection.where({ _id: id, _openid: openid }).limit(1).get();
          const existing = found.data[0];
          if (!existing) throw err;
          if (existing.participantCode !== submission.participantCode ||
              existing.questionnaireVersion !== submission.questionnaireVersion ||
              JSON.stringify(existing.answers) !== JSON.stringify(submission.answers)) {
            throw new InputError('本次问卷已提交，请从问卷记录查看', 'SUBMISSION_CONFLICT');
          }
          return { ok: true, data: publicRecord(existing) };
        }
      }
      if (event.action === 'list') {
        const code = participantCode(event.participantCode);
        const offset = event.offset === undefined ? 0 : event.offset;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new InputError('分页参数无效');
        const result = await collection.where({ _openid: openid, participantCode: code })
          .orderBy('createdAt', 'desc').orderBy('_id', 'desc').skip(offset).limit(PAGE_SIZE + 1).get();
        const items = result.data.slice(0, PAGE_SIZE).map(publicRecord);
        return { ok: true, data: { items, hasMore: result.data.length > PAGE_SIZE, nextOffset: offset + items.length } };
      }
      if (event.action === 'get') {
        if (typeof event.responseId !== 'string' || !/^q_[a-f0-9]{30}$/.test(event.responseId)) throw new InputError('问卷记录编号无效');
        // 云函数拥有管理员权限，所有读操作均显式限制微信身份；不信任传入的 _openid。
        const result = await collection.where({ _id: event.responseId, _openid: openid }).limit(1).get();
        if (!result.data.length) throw new InputError('问卷记录不存在或无权查看', 'NOT_FOUND');
        return { ok: true, data: publicRecord(result.data[0]) };
      }
      throw new InputError('不支持的问卷操作');
    } catch (err) {
      if (err instanceof InputError) return { ok: false, code: err.code, message: err.message };
      console.error('[questionnaire] request failed', err);
      return { ok: false, code: 'UNAVAILABLE', message: '问卷服务暂不可用，请稍后重试' };
    }
  };
}

module.exports = { createHandler, validateSubmission };
