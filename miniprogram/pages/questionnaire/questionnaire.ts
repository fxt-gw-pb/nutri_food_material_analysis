import { QUESTIONNAIRE_QUESTIONS, QUESTIONNAIRE_TITLE, QUESTIONNAIRE_VERSION } from '../../data/questionnaire';
import { QuestionnaireAnswers, QuestionnaireQuestion, QuestionnaireRecord } from '../../types/questionnaire';
import { chooseQuestionnaireOption, formatQuestionnaireTime, newQuestionnaireSubmissionId, validateQuestionnaireAnswers } from '../../utils/questionnaire';
import { getUserProfile, normalizeParticipantCode } from '../../services/userProfile';
import { clearQuestionnaireDraft, getQuestionnaireDraft, saveQuestionnaireDraft } from '../../services/questionnaireDraft';
import { getQuestionnaireRecord, QuestionnaireRequestError, submitQuestionnaire } from '../../services/questionnaireService';
import { CONFIG } from '../../services/config';

interface QuestionView extends QuestionnaireQuestion {
  number: number;
  answered: boolean;
  options: { value: string; label: string; selected: boolean }[];
}

Page({
  data: {
    title: QUESTIONNAIRE_TITLE, participantCode: '', loaded: false, loadError: '',
    busy: false, pending: false, saved: false, answeredCount: 0, progress: 0,
    questions: [] as QuestionView[], saveText: '', submitError: '', invalidId: '',
    savedTime: '', savedAnswers: [] as { questionId: string; question: string; text: string }[],
    mockMode: !CONFIG.useCloud,
  },
  answers: {} as QuestionnaireAnswers,
  submissionId: '',
  responseId: '',
  requestedCode: '',

  onLoad(query: Record<string, string | undefined>) {
    this.responseId = query.responseId || '';
    try {
      this.requestedCode = query.participantCode ? normalizeParticipantCode(decodeURIComponent(query.participantCode)) : '';
    } catch (err) {
      this.setData({ loaded: true, loadError: '参与者编号无效，请返回首页重新填写' });
      return;
    }
    void this.loadQuestionnaire();
  },

  async loadQuestionnaire() {
    this.setData({ loaded: false, loadError: '' });
    try {
      if (this.responseId) {
        this.showRecord(await getQuestionnaireRecord(this.responseId));
        return;
      }
      const code = normalizeParticipantCode(this.requestedCode || getUserProfile()?.participantCode || '');
      const draft = getQuestionnaireDraft(code);
      this.submissionId = draft?.submissionId || newQuestionnaireSubmissionId();
      this.answers = draft?.answers || {};
      this.setData({ loaded: true, participantCode: code, pending: draft?.pending || false,
        saveText: draft ? (draft.pending ? '上次提交结果尚未确认，请点击“重试提交”' : '已恢复此参与者的草稿') : '答案会自动保存在此手机，填完后请提交',
      });
      this.refreshQuestions();
    } catch (err) {
      console.error('[questionnaire] load failed', err);
      this.setData({ loaded: true, loadError: err instanceof Error ? err.message : '加载失败，请重试' });
    }
  },

  refreshQuestions() {
    const questions: QuestionView[] = QUESTIONNAIRE_QUESTIONS.map((question, index) => ({
      ...question, number: index + 1, answered: !!this.answers[question.id]?.length,
      options: question.options.map((option) => ({ ...option, selected: (this.answers[question.id] || []).includes(option.value) })),
    }));
    const answeredCount = questions.filter((question) => question.answered).length;
    this.setData({ questions, answeredCount, progress: Math.round(answeredCount / questions.length * 100) });
  },

  chooseOption(e: WechatMiniprogram.TouchEvent) {
    if (!this.data.loaded || this.data.loadError || this.data.busy || this.data.pending || this.data.saved) return;
    const { question, value } = e.currentTarget.dataset as { question: string; value: string };
    this.answers = chooseQuestionnaireOption(this.answers, question, value);
    this.setData({ invalidId: '', submitError: '' });
    this.refreshQuestions();
    try {
      this.writeDraft(false);
      this.setData({ saveText: '草稿已保存在此手机，尚未提交' });
    } catch (err) {
      console.error('[questionnaire] draft save failed', err);
      this.setData({ saveText: '草稿保存失败，请勿退出；可重试提交' });
    }
  },

  writeDraft(pending: boolean) {
    saveQuestionnaireDraft({ participantCode: this.data.participantCode, submissionId: this.submissionId,
      questionnaireVersion: QUESTIONNAIRE_VERSION, answers: this.answers, pending, updatedAt: Date.now() });
  },

  async submit() {
    if (!this.data.loaded || this.data.loadError || this.data.busy || this.data.saved) return;
    try {
      this.answers = validateQuestionnaireAnswers(this.answers, true);
    } catch (err) {
      const missing = QUESTIONNAIRE_QUESTIONS.find((question) => !this.answers[question.id]?.length);
      const message = err instanceof Error ? err.message : '请完成所有题目';
      this.setData({ invalidId: missing?.id || '', submitError: message });
      wx.showToast({ title: message, icon: 'none' });
      if (missing) wx.pageScrollTo({ selector: `#question-${missing.id}`, duration: 250 });
      return;
    }
    this.setData({ busy: true, submitError: '' });
    // 先持久化本次提交编号和完整答案；不能保存时不发请求，防止退出后丢失重试编号。
    try {
      this.writeDraft(true);
    } catch (err) {
      this.setData({ busy: false, submitError: '本机保存失败，尚未提交。请检查手机存储后重试。' });
      return;
    }
    this.setData({ pending: true, saveText: '正在提交，请稍候…' });
    try {
      const record = await submitQuestionnaire({ participantCode: this.data.participantCode,
        submissionId: this.submissionId, questionnaireVersion: QUESTIONNAIRE_VERSION, answers: this.answers });
      this.showRecord(record);
      try { clearQuestionnaireDraft(record.participantCode); }
      catch (err) { console.warn('[questionnaire] draft cleanup failed', err); }
    } catch (err) {
      console.error('[questionnaire] submit failed', err);
      const rejected = err instanceof QuestionnaireRequestError && err.code === 'INVALID_INPUT';
      if (rejected) {
        this.setData({ pending: false });
        try { this.writeDraft(false); } catch (storageError) { console.warn('[questionnaire] draft save failed', storageError); }
      }
      this.setData({ saveText: '答案已保存在此手机',
        submitError: err instanceof QuestionnaireRequestError && err.code !== 'UNAVAILABLE'
          ? err.message : '提交结果尚未确认，请联网后重试。同一次提交不会重复保存。' });
    } finally {
      this.setData({ busy: false });
    }
  },

  showRecord(record: QuestionnaireRecord) {
    this.responseId = record.responseId;
    this.setData({ loaded: true, loadError: '', saved: true, pending: false, title: record.title,
      participantCode: record.participantCode, savedTime: formatQuestionnaireTime(record.createdAt),
      savedAnswers: record.answerItems.map((item) => ({ questionId: item.questionId, question: item.question, text: item.labels.join('、') })),
      submitError: '', saveText: '',
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  goHistory() {
    if (this.data.busy || !this.data.participantCode) return;
    const pages = getCurrentPages();
    if (pages.length > 1 && pages[pages.length - 2].route === 'pages/questionnaire-history/questionnaire-history') {
      wx.navigateBack({ delta: 1 });
    } else {
      // 离开填写页后只保留草稿，避免在页面栈中同时打开两份相同提交编号的表单。
      wx.redirectTo({ url: `/pages/questionnaire-history/questionnaire-history?participantCode=${encodeURIComponent(this.data.participantCode)}` });
    }
  },

  goHome() {
    if (!this.data.busy) wx.reLaunch({ url: '/pages/index/index' });
  },
});
