import { createHash } from 'node:crypto';
import type { ChoiceOption, FileKind, FormDefinition, Question, StructureQuestion } from '../../shared/types.ts';
import type { EngineEnv } from './env.ts';

const ALL_FILE_KINDS: FileKind[] = ['pdf', 'png', 'jpeg'];

/** Options sorted by the ascending hex SHA-256 of `<seed>:<question key>:<option value>`. */
function shuffled(question: Question, seed: string): ChoiceOption[] {
  const digest = (option: ChoiceOption): string =>
    createHash('sha256').update(`${seed}:${question.key}:${option.value}`).digest('hex');
  return (question.options ?? [])
    .map((option) => ({ option, digest: digest(option) }))
    .sort((a, b) => (a.digest < b.digest ? -1 : Number(a.digest > b.digest)))
    .map(({ option }) => option);
}

function structureOf(question: Question, env: EngineEnv): StructureQuestion {
  const structure: StructureQuestion = { type: question.type, required: question.required === true };
  switch (question.type) {
    case 'choice':
    case 'checkbox':
      structure.options = question.shuffle === true ? shuffled(question, env.shuffleSeed) : question.options;
      break;
    case 'dropdown':
    case 'ranking':
      structure.options = question.options;
      break;
    case 'grid':
      structure.rows = question.rows;
      structure.columns = question.columns;
      break;
    case 'number':
      structure.min = question.min;
      structure.max = question.max;
      structure.decimals = question.decimals;
      break;
    case 'date':
      structure.min = question.min;
      structure.max = question.max;
      break;
    case 'scale':
      structure.min = question.min;
      structure.max = question.max;
      structure.min_label = question.min_label;
      structure.max_label = question.max_label;
      break;
    case 'file':
      structure.accept = question.accept ?? ALL_FILE_KINDS;
      structure.max_bytes = question.max_bytes;
      break;
    case 'short_text':
    case 'long_text':
    case 'calculated':
      break;
  }
  return structure;
}

/** The static, safe part of a form for the respondent screen: no labels, formulas or notes, no hidden calculated fields. */
export function respondentStructure(definition: FormDefinition, env: EngineEnv): Record<string, StructureQuestion> {
  const visible = definition.pages.flatMap((page) => page.questions).filter((question) => question.hidden !== true);
  return Object.fromEntries(visible.map((question) => [question.key, structureOf(question, env)]));
}
