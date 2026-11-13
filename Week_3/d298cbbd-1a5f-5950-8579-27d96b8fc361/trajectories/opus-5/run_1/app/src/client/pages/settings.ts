import { el } from '../dom.js';
import { radioGroup } from '../controls.js';
import type { Page } from '../router.js';
import {
  applyTheme,
  saveSettings,
  state,
  type CaretStyle,
  type QuickRestart,
  type Theme,
} from '../state.js';
import { heading } from '../shell.js';

function checkbox(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox', class: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'check' }, [input, el('span', {}, [label])]);
}

export class SettingsPage implements Page {
  render(container: HTMLElement): void {
    container.textContent = '';
    const folder = el('div', { class: 'folder open back' });
    folder.append(heading(1, 'Settings'));

    const change = (): void => {
      saveSettings();
      applyTheme();
    };

    folder.append(
      radioGroup({
        label: 'Theme',
        options: ['sand', 'cobalt', 'carbon', 'ledger'].map((value) => ({ value, label: value })),
        value: state.settings.theme,
        onChange: (value) => {
          state.settings.theme = value as Theme;
          change();
        },
      }).element,
      radioGroup({
        label: 'Caret',
        options: ['line', 'block', 'underline', 'off'].map((value) => ({ value, label: value })),
        value: state.settings.caret,
        onChange: (value) => {
          state.settings.caret = value as CaretStyle;
          change();
        },
      }).element,
      radioGroup({
        label: 'Font size',
        options: ['1', '1.5', '2', '3'].map((value) => ({ value, label: value })),
        value: String(state.settings.fontSize),
        onChange: (value) => {
          state.settings.fontSize = Number(value);
          change();
        },
      }).element,
      radioGroup({
        label: 'Quick restart',
        options: ['tab', 'enter'].map((value) => ({ value, label: value })),
        value: state.settings.quickRestart,
        onChange: (value) => {
          state.settings.quickRestart = value as QuickRestart;
          change();
        },
      }).element,
      checkbox('Smooth caret', state.settings.smoothCaret, (checked) => {
        state.settings.smoothCaret = checked;
        change();
      }),
      checkbox('Blind mode', state.settings.blindMode, (checked) => {
        state.settings.blindMode = checked;
        change();
      }),
    );
    container.append(folder);
  }
}
