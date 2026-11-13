import { api, type TypistSettings } from './api.js';
import { el } from './dom.js';
import type { PageContext } from './main.js';

// Settings: the six groups, printed on the back of a folder.

export function renderSettings(context: PageContext, folder: HTMLElement): void {
  const { app } = context;
  const sheetEl = el('div', { class: 'sheet settings-sheet' }, '');
  const settings = app.state.settings;

  const groups: { label: string; options: { value: string; current: boolean; pick: (value: string) => void }[] }[] = [
    {
      label: 'Theme',
      options: (['sand', 'cobalt', 'carbon', 'ledger'] as const).map((value) => ({
        value, current: settings.theme === value, pick: (v: string) => app.updateSettings({ theme: v as TypistSettings['theme'] }),
      })),
    },
    {
      label: 'Caret',
      options: (['line', 'block', 'underline', 'off'] as const).map((value) => ({
        value, current: settings.caret === value, pick: (v: string) => app.updateSettings({ caret: v as TypistSettings['caret'] }),
      })),
    },
    {
      label: 'Font size',
      options: ['1', '1.5', '2', '3'].map((value) => ({
        value, current: String(settings.fontSize) === value, pick: (v: string) => app.updateSettings({ fontSize: Number(v) }),
      })),
    },
    {
      label: 'Quick restart',
      options: (['tab', 'enter'] as const).map((value) => ({
        value, current: settings.quickRestart === value, pick: (v: string) => app.updateSettings({ quickRestart: v as TypistSettings['quickRestart'] }),
      })),
    },
  ];

  for (const group of groups) {
    const groupEl = el('div', { class: 'mode-group', role: 'radiogroup', 'aria-label': group.label }, '');
    group.options.forEach((option) => {
      const id = `settings-${group.label.replace(/\s+/g, '-')}-${option.value}`;
      const input = el('input', { type: 'radio', name: `settings-${group.label}`, id, value: option.value }) as unknown as HTMLInputElement;
      input.checked = option.current;
      input.addEventListener('change', () => option.pick(option.value));
      const label = el('label', { for: id, class: 'mode-label' }, option.value);
      groupEl.append(input, label);
    });
    sheetEl.append(el('h3', { class: 'settings-group-label' }, group.label), groupEl);
  }

  for (const [key, label] of [['smoothCaret', 'Smooth caret'], ['blindMode', 'Blind mode']] as const) {
    const input = el('input', { type: 'checkbox', id: `settings-${key}` }) as unknown as HTMLInputElement;
    input.checked = settings[key];
    input.addEventListener('change', () => app.updateSettings({ [key]: input.checked } as Partial<TypistSettings>));
    const labelEl = el('label', { for: `settings-${key}`, class: 'mode-label' }, label);
    sheetEl.append(input, labelEl);
  }

  const saveNote = el('p', { class: 'settings-note' }, 'Settings apply at once and are kept on this browser.');
  sheetEl.appendChild(saveNote);
  folder.appendChild(sheetEl);
  void context;
}
