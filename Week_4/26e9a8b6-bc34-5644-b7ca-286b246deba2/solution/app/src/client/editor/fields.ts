import { h } from '../dom';
import type { Binding, Committer } from './commits';
import type { EditorState } from './state';
import { same } from './state';

const COMMIT_MS = 250;

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface FieldSpec<V> {
  path: string;
  label: string;
  control: Control;
  /** committed value to control text */
  toText(value: V): string;
  /** control text to value; null leaves the field alone (not a value yet) */
  fromText(text: string): V | null;
  undoLabel?: () => string;
  /** for checkbox-like controls read this instead of the text */
  state: EditorState;
  committer: Committer;
}

/** Text, number, slider and select controls: commit 250 ms after the last change and on leaving the field. */
export function bindControl<V>(spec: FieldSpec<V>): Binding {
  const { control, committer } = spec;
  let timer = 0;
  let refused: string | null = null;
  const text = () => control.value;
  const committedText = () => spec.toText(spec.state.read(spec.path) as V);
  const dirty = () => text() !== committedText();
  const binding: Binding = {
    path: spec.path,
    label: spec.label,
    show(value) {
      clearTimeout(timer);
      timer = 0;
      control.value = spec.toText(value as V);
      refused = null;
    },
    pending: () => timer !== 0 || dirty(),
    current: () => spec.fromText(text()),
    async flush() {
      clearTimeout(timer);
      timer = 0;
      await commit();
    },
  };
  async function commit(): Promise<void> {
    if (!dirty() || refused === text()) return;
    const value = spec.fromText(text());
    if (value === null) return;
    const ok = await committer.commit(spec.path, value, { undoLabel: spec.undoLabel?.(), binding });
    refused = ok || same(spec.state.read(spec.path), value) ? null : text();
  }
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      void commit();
    }, COMMIT_MS);
  };
  control.addEventListener('input', schedule);
  control.addEventListener('change', schedule);
  control.addEventListener('blur', () => {
    clearTimeout(timer);
    timer = 0;
    void commit();
  });
  committer.register(binding);
  return binding;
}

/** A labelled cell wrapping a control (adjoining outlined cells). */
export function cell(id: string, label: string, control: Control, ...extra: Node[]): HTMLElement {
  control.id = id;
  control.classList.add('field-input');
  return h('label', { class: 'cell', for: id }, h('span', { class: 'cell-label' }, label), control, ...extra);
}
