import { undoLabel } from '../../shared/copy';
import { partLabels } from '../../shared/part-label';
import { CURRENCIES, type Callout, type Phase, type Step } from '../../shared/types';
import { h, replace } from '../dom';
import { phaseNames } from '../reader/panel';
import type { Binding } from './commits';
import { bindControl, cell } from './fields';
import type { Editor } from './editor';

interface Row { id: string; element: HTMLElement; labels: Record<'title' | 'text' | 'phase' | 'delete', HTMLElement>; bindings: Binding[] }

const COMMIT_MS = 250;

/** Guide details, one row per step (title, text, phase, delete), and the selected step's parts and callouts. */
export class StepsPane {
  readonly element: HTMLElement;
  private readonly rows = new Map<string, Row>();
  private readonly list = h('div', { class: 'step-rows' });
  private readonly partsGroup = h('div', { role: 'group', 'aria-label': 'Parts in this step', class: 'parts-group' });
  private partBindings: Binding[] = [];
  private calloutListener: ((event: Event) => void) | null = null;

  constructor(private readonly editor: Editor) {
    this.element = h('div', { class: 'pane steps-pane' }, this.details(), this.list, this.partsGroup);
  }

  private details(): HTMLElement {
    const { state, committer } = this.editor;
    const title = h('input', { type: 'text', autocomplete: 'off' });
    const currency = h('select', {}, ...CURRENCIES.map((c) => h('option', { value: c }, c)));
    const tags = h('input', { type: 'text', autocomplete: 'off' });
    const visibility = h('select', {}, h('option', { value: 'public' }, 'Public'), h('option', { value: 'private' }, 'Private'));
    for (const [control, label] of [[title, 'Guide title'], [tags, 'Tags']] as const) control.setAttribute('aria-label', label);
    currency.setAttribute('aria-label', 'Currency');
    visibility.setAttribute('aria-label', 'Visibility');
    const spec = { state, committer };
    const text = (value: unknown) => String(value ?? '');
    bindControl({ ...spec, path: 'title', label: 'Guide title', control: title, toText: text, fromText: (v) => v, undoLabel: () => undoLabel.guideTitle });
    bindControl({ ...spec, path: 'currency', label: 'Currency', control: currency, toText: text, fromText: (v) => v });
    bindControl<string[]>({ ...spec, path: 'tags', label: 'Tags', control: tags, toText: (v) => v.join(', '), fromText: (v) => v.split(',').map((t) => t.trim()).filter(Boolean) });
    bindControl({ ...spec, path: 'visibility', label: 'Visibility', control: visibility, toText: text, fromText: (v) => v });
    for (const [control, path] of [[title, 'title'], [currency, 'currency'], [tags, 'tags'], [visibility, 'visibility']] as const)
      control.value = path === 'tags' ? state.work.tags.join(', ') : String(state.read(path));
    return h('div', { class: 'form guide-details' },
      cell('guide-title', 'Guide title', title), cell('guide-currency', 'Currency', currency),
      cell('guide-tags', 'Tags', tags), cell('guide-visibility', 'Visibility', visibility));
  }

  sync(): void {
    const { state, committer } = this.editor;
    const keep = document.activeElement;
    const live = new Set(state.work.steps.map((s) => s.id));
    for (const [id, row] of this.rows) {
      if (live.has(id)) continue;
      for (const b of row.bindings) committer.unregister(b.path);
      row.element.remove();
      this.rows.delete(id);
    }
    for (const step of state.work.steps) {
      let row = this.rows.get(step.id);
      if (!row) {
        row = this.buildRow(step);
        this.rows.set(step.id, row);
      }
      this.relabel(row, step.number);
      for (const b of row.bindings) if (!b.pending()) b.show(state.read(b.path));
      row.element.classList.toggle('is-selected', state.selectedStep === step.id);
    }
    const ordered = state.work.steps.map((s) => this.rows.get(s.id)!.element);
    if (ordered.some((el, i) => this.list.children[i] !== el)) this.list.append(...ordered);
    if (keep instanceof HTMLElement && document.activeElement !== keep && keep.isConnected) keep.focus();
    this.syncParts();
  }

  private relabel(row: Row, n: number): void {
    row.element.setAttribute('aria-label', `Step ${n}`);
    row.labels.title.textContent = `Step ${n} title`;
    row.labels.text.textContent = `Step ${n} text`;
    row.labels.phase.textContent = `Step ${n} phase`;
    row.labels.delete.textContent = `Delete step ${n}`;
    const [title, text, phase] = row.bindings as [Binding, Binding, Binding];
    title.label = `Step ${n} title`;
    text.label = `Step ${n} text`;
    phase.label = `Step ${n} phase`;
  }

  focusTitle(id: string): void {
    this.rows.get(id)?.element.querySelector('input')?.focus();
  }

  private buildRow(step: Step): Row {
    const { state, committer } = this.editor;
    const number = () => state.stepNumber(step.id);
    const title = h('input', { type: 'text', autocomplete: 'off' });
    const text = h('textarea', { rows: 3 });
    const phase = h('select', {}, ...(Object.keys(phaseNames) as Phase[]).map((p) => h('option', { value: p }, phaseNames[p])));
    const remove = h('button', { type: 'button', class: 'button quiet' });
    const labelOf = (control: HTMLElement) => control.closest('label')!.querySelector<HTMLElement>('.cell-label')!;
    const spec = { state, committer };
    const base = `step/${step.id}`;
    const plain = (v: unknown) => String(v ?? '');
    const bindings = [
      bindControl({ ...spec, path: `${base}/title`, label: '', control: title, toText: plain, fromText: (v) => v, undoLabel: () => undoLabel.stepTitle(number()) }),
      bindControl({ ...spec, path: `${base}/text`, label: '', control: text, toText: plain, fromText: (v) => v, undoLabel: () => undoLabel.stepText(number()) }),
      bindControl({ ...spec, path: `${base}/phase`, label: '', control: phase, toText: plain, fromText: (v) => v, undoLabel: () => undoLabel.stepPhase(number()) }),
    ];
    for (const binding of bindings) binding.show(state.read(binding.path));
    const titleCell = cell(`step-${step.id}-title`, '', title);
    const textCell = cell(`step-${step.id}-text`, '', text);
    const phaseCell = cell(`step-${step.id}-phase`, '', phase);
    const element = h('div', { role: 'group', class: 'step-row', 'data-step-id': step.id }, titleCell, textCell, phaseCell, remove);
    remove.addEventListener('click', () => void this.editor.deleteStep(step.id));
    element.addEventListener('focusin', () => this.editor.selectStep(step.id));
    element.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      event.preventDefault();
      void this.editor.moveStep(step.id, event.key === 'ArrowUp' ? -1 : 1);
    });
    return { id: step.id, element, labels: { title: labelOf(title), text: labelOf(text), phase: labelOf(phase), delete: remove }, bindings };
  }

  /** The selected step's focus parts as checkboxes, and one callout box for each ticked part. */
  syncParts(): void {
    const { state, committer } = this.editor;
    for (const b of this.partBindings) committer.unregister(b.path);
    this.partBindings = [];
    const step = state.selected();
    if (!step) return replace(this.partsGroup);
    const labels = partLabels(state.work.parts);
    const focusPath = `step/${step.id}/focus_parts`;
    const calloutPath = `step/${step.id}/callouts`;
    const boxes = new Map(state.work.parts.map((part) => [part.id, h('input', { type: 'checkbox' })]));
    const callouts = new Map<string, HTMLInputElement>();
    const callout = (partId: string, text: string) => {
      const input = h('input', { type: 'text', autocomplete: 'off', 'aria-label': `Callout for ${labels.get(partId)}`, value: text });
      callouts.set(partId, input);
      return h('label', { class: 'cell callout-cell' }, h('span', { class: 'cell-label' }, `Callout for ${labels.get(partId)}`), input);
    };
    const focusFrom = () => {
      const kept = step.focus_parts.filter((id) => boxes.get(id)?.checked);
      return [...kept, ...[...boxes].filter(([id, box]) => box.checked && !kept.includes(id)).map(([id]) => id)];
    };
    const calloutsFrom = (): Callout[] => {
      const existing = new Map(step.callouts.map((c) => [c.part_id, c.text]));
      return step.focus_parts.filter((id) => boxes.get(id)?.checked).map((id) => ({ part_id: id, text: callouts.get(id)?.value ?? existing.get(id) ?? '' }))
        .concat([...boxes].filter(([id, box]) => box.checked && !step.focus_parts.includes(id)).map(([id]) => ({ part_id: id, text: callouts.get(id)?.value ?? '' })));
    };
    const timers: Record<string, number> = {};
    const makeBinding = (path: string, label: string, current: () => unknown, show: (v: unknown) => void, undo: string): Binding => {
      const binding: Binding = {
        path, label,
        show,
        pending: () => (timers[path] ?? 0) !== 0,
        current,
        async flush() {
          clearTimeout(timers[path]);
          timers[path] = 0;
          await committer.commit(path, current(), { undoLabel: undo, binding });
        },
      };
      committer.register(binding);
      this.partBindings.push(binding);
      return binding;
    };
    const schedule = (binding: Binding) => {
      clearTimeout(timers[binding.path]);
      timers[binding.path] = window.setTimeout(() => {
        timers[binding.path] = 0;
        void committer.commit(binding.path, binding.current(), { undoLabel: binding.path.endsWith('callouts') ? undoLabel.callout(state.stepNumber(step.id)) : undoLabel.stepParts(state.stepNumber(step.id)), binding });
      }, COMMIT_MS);
    };
    const focusBinding = makeBinding(focusPath, 'Parts in this step', focusFrom, (v) => {
      for (const [id, box] of boxes) box.checked = (v as string[]).includes(id);
      this.syncParts();
    }, undoLabel.stepParts(state.stepNumber(step.id)));
    const calloutBinding = makeBinding(calloutPath, 'Callouts', calloutsFrom, () => this.syncParts(), undoLabel.callout(state.stepNumber(step.id)));
    const rows = state.work.parts.map((part) => {
      const box = boxes.get(part.id)!;
      box.checked = step.focus_parts.includes(part.id);
      box.addEventListener('change', () => {
        schedule(focusBinding);
        const present = this.partsGroup.querySelector(`[data-callout-for="${part.id}"]`);
        if (box.checked && !present) row.after(h('div', { 'data-callout-for': part.id }, callout(part.id, step.callouts.find((c) => c.part_id === part.id)?.text ?? '')));
        else if (!box.checked && present) present.remove();
      });
      const row = h('label', { class: 'check' }, box, h('span', {}, labels.get(part.id)));
      return [row, box.checked ? h('div', { 'data-callout-for': part.id }, callout(part.id, step.callouts.find((c) => c.part_id === part.id)?.text ?? '')) : null];
    });
    replace(this.partsGroup, h('h3', {}, 'Parts in this step'), ...rows.flat());
    if (this.calloutListener) this.partsGroup.removeEventListener('input', this.calloutListener);
    this.calloutListener = (event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'text') schedule(calloutBinding);
    };
    this.partsGroup.addEventListener('input', this.calloutListener);
  }
}
