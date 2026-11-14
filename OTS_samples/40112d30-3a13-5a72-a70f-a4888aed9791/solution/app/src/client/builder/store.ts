import type { FormDefinition, FormDetail, Page, Person, Question } from '../../shared/types.ts';
import { Emitter } from './emitter.ts';

// The one copy of the form the builder shows: the draft at its revision, the form's state, and what is selected.

interface Selection { page: string; question: string | null }

export class Store {
  readonly drafted = new Emitter();
  readonly selected = new Emitter();
  readonly detailed = new Emitter();
  draft: FormDefinition;
  rev: number;
  selection: Selection;

  constructor(public detail: FormDetail, readonly me: Person) {
    this.draft = detail.draft;
    this.rev = detail.rev;
    this.selection = { page: detail.draft.pages[0]?.key ?? '', question: null };
  }

  currentPage(): Page | undefined {
    return this.draft.pages.find((page) => page.key === this.selection.page);
  }

  selectedQuestion(): Question | undefined {
    return this.currentPage()?.questions.find((question) => question.key === this.selection.question);
  }

  questions(): Question[] {
    return this.draft.pages.flatMap((page) => page.questions);
  }

  select(selection: Selection): void {
    this.selection = selection;
    this.selected.emit();
  }

  replaceDraft(draft: FormDefinition, rev: number): void {
    this.draft = draft;
    this.rev = rev;
    this.keepSelection();
    this.drafted.emit();
  }

  /** The server's own account of the form (state, edition, settings, problems) replaces ours. */
  replaceDetail(detail: FormDetail): void {
    this.detail = detail;
    this.detailed.emit();
  }

  updateState(patch: Partial<Pick<FormDetail, 'state' | 'closed_reason' | 'edition' | 'settings' | 'problems'>>): void {
    this.detail = { ...this.detail, ...patch };
    this.detailed.emit();
  }

  /** A change from anywhere can remove what is selected: fall back to the page, then to the first page. */
  private keepSelection(): void {
    const { page, question } = this.selection;
    const owner = question === null ? undefined : this.draft.pages.find((candidate) => candidate.questions.some((q) => q.key === question));
    if (owner) {
      if (owner.key !== page) this.select({ page: owner.key, question });
      return;
    }
    const kept = this.draft.pages.find((candidate) => candidate.key === page)?.key ?? this.draft.pages[0]?.key ?? '';
    if (question !== null || kept !== page) this.select({ page: kept, question: null });
  }
}
