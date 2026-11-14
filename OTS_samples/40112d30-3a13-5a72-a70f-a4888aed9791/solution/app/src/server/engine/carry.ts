import type { Answers, AnswerValue, FormDefinition, Question } from '../../shared/types.ts';
import { answerFits, answerOf, isBlank, textOf } from './answers.ts';
import { dateProblem, lengthProblem, numberProblem, scaleFits } from './constraints.ts';
import type { EngineEnv } from './env.ts';
import { outlineOf } from './outline.ts';
import { questionsByKey, walkForm } from './resolve.ts';

interface Carried {
  /** The answers that are still valid on the new edition. */
  answers: Answers;
  /** Keys of the answers that were dropped, in the old edition's form order. */
  dropped: string[];
  /** The old edition's labels of those questions, raw, in the same order. */
  droppedLabels: string[];
}

/** Whether an answer given on an older edition is still allowed by the same question on the newer one. */
function stillAllowed(question: Question, answer: AnswerValue): boolean {
  if (question.type === 'file') return true;
  if (!answerFits(question, answer)) return false;
  const text = textOf(answer);
  switch (question.type) {
    case 'number':
      return numberProblem(question, text) === null;
    case 'date':
      return dateProblem(question, text) === null;
    case 'scale':
      return scaleFits(question, text);
    case 'short_text':
    case 'long_text':
      return lengthProblem(question, text) !== 'max';
    default:
      return true;
  }
}

/** Keeps each answer whose key still exists with the same type and whose value is still allowed. */
export function carryAnswers(oldDefinition: FormDefinition, newDefinition: FormDefinition, answers: Answers): Carried {
  const newer = outlineOf(newDefinition).byKey;
  const kept: Answers = {};
  const dropped: Question[] = [];
  for (const { question: old } of outlineOf(oldDefinition).questions) {
    const answer = answerOf(answers, old.key);
    if (answer === undefined || isBlank(answer)) continue;
    const current = newer.get(old.key)?.question;
    if (current?.type === old.type && stillAllowed(current, answer)) kept[old.key] = answer;
    else dropped.push(old);
  }
  return { answers: kept, dropped: dropped.map((question) => question.key), droppedLabels: dropped.map((question) => question.label) };
}

/**
 * The page a resume link opens on the newer edition: the first shown page with an empty required question or a
 * dropped answer, else the saved page (or the first shown page when the saved page is no longer shown).
 */
export function pageToOpen(
  newDefinition: FormDefinition, answers: Answers, droppedKeys: string[], savedPage: string, env: EngineEnv,
): string {
  const walked = walkForm(newDefinition, answers, env);
  const shown = questionsByKey(walked.resolved);
  const needsAttention = walked.outline.questions.find(({ question }) =>
    shown.get(question.key)?.state === 'lit' && question.type !== 'calculated'
      && (droppedKeys.includes(question.key) || (question.required === true && !walked.effective.has(question.key))));
  if (needsAttention !== undefined) return needsAttention.page.key;
  const { shownPageKeys } = walked.resolved;
  return shownPageKeys.includes(savedPage) ? savedPage : shownPageKeys[0] ?? savedPage;
}
