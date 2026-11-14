import type { FormDefinition, Jump } from '../../shared/types.ts';
import { formulaLimits } from './env.ts';
import type { EngineEnv } from './env.ts';
import { referenceProblem } from './formula/analyze.ts';
import type { ReferenceScope } from './formula/analyze.ts';
import { parseFormula } from './formula/parser.ts';
import { insertionProblem } from './insertion.ts';
import { outlineOf } from './outline.ts';

export interface DefinitionProblem {
  /** The question key, page key or check target the problem belongs to. */
  key: string;
  /** 'formula', 'show_rule', 'jumps', 'fail_when', 'label', 'help', 'title' or 'message'. */
  field: string;
  message: string;
}

/** Every save-time refusal that currently exists in the formulas, rules, jumps, checks and insertions of a definition. */
export function definitionProblems(definition: FormDefinition, env: EngineEnv): DefinitionProblem[] {
  const outline = outlineOf(definition);
  const limits = formulaLimits(env);
  const problems: DefinitionProblem[] = [];

  const report = (key: string, field: string, message: string | null): void => {
    if (message !== null) problems.push({ key, field, message });
  };

  const formulaProblem = (formula: string, scope: ReferenceScope): string | null => {
    const parsed = parseFormula(formula, limits);
    return parsed.ok ? referenceProblem(parsed.expression, scope, outline) : parsed.refusal;
  };

  const jumpProblem = (jump: Jump, index: number, scope: ReferenceScope): string | null => {
    const target = definition.pages.findIndex((candidate) => candidate.key === jump.to);
    return formulaProblem(jump.when, scope) ?? (target > index ? null : 'A jump can only go to a later page.');
  };

  for (const [index, page] of definition.pages.entries()) {
    const start = outline.pageStart.get(page.key) ?? 0;
    const end = outline.pageEnd.get(page.key) ?? 0;
    report(page.key, 'show_rule', page.show_rule === undefined ? null : formulaProblem(page.show_rule.when, { limit: start, own: null }));
    const jumpsScope: ReferenceScope = { limit: end, own: null };
    report(page.key, 'jumps', (page.jumps ?? []).map((jump) => jumpProblem(jump, index, jumpsScope)).find((message) => message !== null) ?? null);
    report(page.key, 'title', insertionProblem(page.title, start, outline));

    for (const [offset, question] of page.questions.entries()) {
      const position = start + offset;
      report(question.key, 'label', insertionProblem(question.label, position, outline));
      report(question.key, 'help', question.help === undefined ? null : insertionProblem(question.help, position, outline));
      report(question.key, 'show_rule', question.show_rule === undefined ? null : formulaProblem(question.show_rule.when, {
        limit: position, own: { position, message: 'a rule cannot use the question it belongs to.' },
      }));
      if (question.type === 'calculated') {
        report(question.key, 'formula', formulaProblem(question.formula ?? '', {
          limit: position, own: { position, message: 'a calculated field cannot use itself.' },
        }));
      }
    }
  }

  for (const check of definition.checks) {
    const limit = outline.pageEnd.get(check.page) ?? 0;
    report(check.target, 'fail_when', formulaProblem(check.fail_when, { limit, own: null }));
    report(check.target, 'message', insertionProblem(check.message, limit, outline));
  }
  return problems;
}
