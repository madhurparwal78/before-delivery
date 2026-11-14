import type { Change, FormDefinition, Person, Question } from '../shared/types.ts';
import { applyChange } from '../shared/draft.ts';
import { transaction, type Db } from './db.ts';
import { definitionProblems, normalizeQuestion, validateStructure, type DefinitionProblem } from './engine/index.ts';
import { changeInvalid, duplicateKey, formulaInvalid, validationFailed, type Failure } from './errors.ts';
import { engineEnv, requireAccess } from './forms.ts';
import { publishFormEvent } from './hub.ts';
import { attempt, sequenceKey } from './valkey.ts';

// Co-editing: every applied change gets the next number of the form's sequence, which is its server order and the
// draft's new revision (brief: Live editing). One transaction, one form row lock, so changes apply in that order.

interface Applied { seq: number | null; conflict_with: string | null; dropped?: true }

const OPS = new Set(['set', 'add_question', 'remove_question', 'move_question', 'add_page', 'remove_page']);

function isChange(value: unknown): value is Change {
  if (value === null || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  if (typeof c['op'] !== 'string' || !OPS.has(c['op']) || typeof c['base_rev'] !== 'number') return false;
  switch (c['op']) {
    case 'set': return typeof c['key'] === 'string' && typeof c['field'] === 'string';
    case 'add_question': return typeof c['page'] === 'string' && typeof c['question'] === 'object' && c['question'] !== null;
    case 'remove_question': return typeof c['key'] === 'string';
    case 'move_question': return typeof c['key'] === 'string' && typeof c['position'] === 'number';
    case 'add_page': return typeof c['page'] === 'object' && c['page'] !== null && typeof c['position'] === 'number';
    default: return typeof c['key'] === 'string';
  }
}

const sameProblem = (a: DefinitionProblem, b: DefinitionProblem): boolean => a.key === b.key && a.field === b.field && a.message === b.message;

/** A refusal for any problem this change introduced into a stored formula, rule, check or insertion. */
function newProblem(before: DefinitionProblem[], after: FormDefinition, change: Change): Failure | null {
  if (change.op !== 'set' && change.op !== 'add_question') return null;
  const lacksFormula = (problem: DefinitionProblem): boolean =>
    change.op === 'add_question' && problem.key === change.question.key && problem.field === 'formula' && !change.question.formula;
  const fresh = definitionProblems(after, engineEnv()).find((problem) => !lacksFormula(problem) && !before.some((old) => sameProblem(old, problem)));
  return fresh ? formulaInvalid(fresh.key, fresh.message) : null;
}

function checked(def: FormDefinition, change: Change): FormDefinition | null {
  const fixed: Change = change.op === 'add_question' ? { ...change, question: normalizeQuestion(change.question as Question) } : change;
  const next = applyChange(def, fixed);
  if (!next) return null;
  const issue = validateStructure(next);
  if (issue === null) return next;
  if (issue.code === 'DUPLICATE_KEY') throw duplicateKey();
  if (issue.code === 'VALIDATION_FAILED') throw validationFailed([{ key: issue.key ?? 'key', message: issue.message }]);
  throw changeInvalid(issue.message);
}

/** The change as every builder replays it (defaults filled in). */
const normalized = (change: Change): Change =>
  (change.op === 'add_question' ? { ...change, question: normalizeQuestion(change.question) } : change);

interface ChangeResult { rev: number; applied: Applied[] }

export async function applyChanges(user: Person, formId: string, raw: unknown[]): Promise<ChangeResult> {
  if (!raw.every(isChange)) throw changeInvalid('The change is not one this form understands.');
  const changes: Change[] = raw;
  const events: { seq: number; change: Change; conflict_with: string | null }[] = [];
  const result = await transaction(async (tx) => {
    const { form } = await requireAccess(tx, user.id, formId, { builder: true }, true);
    let draft = form.draft;
    const applied: Applied[] = [];
    const accepted: { change: Change; conflict_with: string | null; slot: number }[] = [];
    for (const change of changes) {
      const before = definitionProblems(draft, engineEnv());
      const next = checked(draft, change);
      if (!next) {
        applied.push({ seq: null, conflict_with: null, dropped: true });
        continue;
      }
      const refusal = newProblem(before, next, change);
      if (refusal) throw refusal;
      const conflict = change.op === 'set' ? await conflictingEditor(tx, formId, user.id, change) : null;
      accepted.push({ change: normalized(change), conflict_with: conflict, slot: applied.length });
      applied.push({ seq: null, conflict_with: conflict });
      draft = next;
    }
    if (accepted.length === 0) return { rev: form.rev, applied };
    let seq = form.rev + 1;
    const last = form.rev + accepted.length;
    await settleSequence(formId, form.rev, accepted.length);
    for (const entry of accepted) {
      await tx.query('INSERT INTO form_changes (form_id, rev, user_id, change) VALUES ($1, $2, $3, $4)', [formId, seq, user.id, JSON.stringify(entry.change)]);
      events.push({ seq, change: entry.change, conflict_with: entry.conflict_with });
      applied[entry.slot] = { seq, conflict_with: entry.conflict_with };
      seq += 1;
    }
    const title = draft.title;
    await tx.query('UPDATE forms SET draft = $2, rev = $3, title = $4 WHERE id = $1', [formId, JSON.stringify(draft), last, title]);
    return { rev: last, applied };
  });
  for (const event of events) {
    await publishFormEvent(formId, { kind: 'frame', frame: { type: 'applied', seq: event.seq, by: user, change: event.change, conflict_with: event.conflict_with } });
  }
  return result;
}

/** The form's Valkey sequence is incremented once per applied change and must agree with the draft revision. */
async function settleSequence(formId: string, rev: number, count: number): Promise<void> {
  const reached = await attempt((client) => client.incrby(sequenceKey(formId), count));
  if (reached !== null && reached !== rev + count) await attempt((client) => client.set(sequenceKey(formId), rev + count));
}

/** Another editor's committed change to the same field after this change's base revision, if any. */
async function conflictingEditor(tx: Db, formId: string, userId: string, change: Extract<Change, { op: 'set' }>): Promise<string | null> {
  const { rows } = await tx.query<{ user_id: string }>(
    `SELECT user_id FROM form_changes
     WHERE form_id = $1 AND rev > $2 AND user_id <> $3 AND change->>'op' = 'set' AND change->>'key' = $4 AND change->>'field' = $5
     ORDER BY rev DESC LIMIT 1`,
    [formId, change.base_rev, userId, change.key, change.field],
  );
  return rows[0]?.user_id ?? null;
}
