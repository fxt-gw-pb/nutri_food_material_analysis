export interface QuestionnaireOption { value: string; label: string }
export interface QuestionnaireQuestion {
  id: string;
  title: string;
  multiple: boolean;
  exclusiveValue?: string;
  options: QuestionnaireOption[];
}
export type QuestionnaireAnswers = Record<string, string[]>;
export interface QuestionnaireSubmission {
  submissionId: string;
  questionnaireVersion: string;
  participantCode: string;
  answers: QuestionnaireAnswers;
}
export interface QuestionnaireAnswerItem {
  questionId: string;
  question: string;
  values: string[];
  labels: string[];
}
export interface QuestionnaireRecord extends QuestionnaireSubmission {
  responseId: string;
  title: string;
  recallPeriod: string;
  createdAt: number;
  answerItems: QuestionnaireAnswerItem[];
}
export interface QuestionnaireHistory {
  items: QuestionnaireRecord[];
  hasMore: boolean;
  nextOffset: number;
}
export interface QuestionnaireDraft extends QuestionnaireSubmission {
  updatedAt: number;
  pending: boolean;
}
