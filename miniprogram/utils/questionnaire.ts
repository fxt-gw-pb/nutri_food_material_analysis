import { QUESTIONNAIRE_QUESTIONS } from '../data/questionnaire';
import { QuestionnaireAnswers, QuestionnaireAnswerItem } from '../types/questionnaire';

/** 前五题单选；第六题多选，“都没有”与所有症状互斥。 */
export function chooseQuestionnaireOption(answers: QuestionnaireAnswers, id: string, value: string): QuestionnaireAnswers {
  const question = QUESTIONNAIRE_QUESTIONS.find((item) => item.id === id);
  if (!question || !question.options.some((option) => option.value === value)) return answers;
  let selected = [...(answers[id] || [])];
  if (!question.multiple) selected = [value];
  else if (selected.includes(value)) selected = selected.filter((item) => item !== value);
  else if (value === question.exclusiveValue) selected = [value];
  else selected = [...selected.filter((item) => item !== question.exclusiveValue), value];
  return { ...answers, [id]: question.options.filter((option) => selected.includes(option.value)).map((option) => option.value) };
}

/** 草稿允许未答；提交必须六题齐全，不接受未知题目、选项或互斥冲突。 */
export function validateQuestionnaireAnswers(input: unknown, complete: boolean): QuestionnaireAnswers {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('问卷答案格式有误');
  const answers = input as Record<string, unknown>;
  if (Object.keys(answers).some((id) => !QUESTIONNAIRE_QUESTIONS.some((question) => question.id === id))) {
    throw new Error('问卷包含未知题目');
  }
  const result: QuestionnaireAnswers = {};
  QUESTIONNAIRE_QUESTIONS.forEach((question, index) => {
    const values = answers[question.id] === undefined ? [] : answers[question.id];
    if (!Array.isArray(values) || values.some((value) => !question.options.some((option) => option.value === value)) ||
        new Set(values).size !== values.length || (!question.multiple && values.length > 1) ||
        (values.length > 1 && question.exclusiveValue && values.includes(question.exclusiveValue))) {
      throw new Error(`第 ${index + 1} 题的答案无效，请重新选择`);
    }
    if (complete && values.length === 0) throw new Error(`请完成第 ${index + 1} 题`);
    result[question.id] = question.options.filter((option) => values.includes(option.value)).map((option) => option.value);
  });
  return result;
}

export function questionnaireAnswerItems(answers: QuestionnaireAnswers): QuestionnaireAnswerItem[] {
  return QUESTIONNAIRE_QUESTIONS.map((question) => ({
    questionId: question.id, question: question.title, values: [...answers[question.id]],
    labels: question.options.filter((option) => answers[question.id].includes(option.value)).map((option) => option.label),
  }));
}

export function newQuestionnaireSubmissionId(): string {
  return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}_${Math.random().toString(36).slice(2, 12)}`;
}

/** 随访时间统一显示 UTC+08:00，不随手机时区改变。 */
export function formatQuestionnaireTime(timestamp: number): string {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  const pad = (n: number): string => `${n}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
