import { type ApiErrorBody, fieldErrors, send } from '../api.js';
import { clear, el } from '../dom.js';
import { FUNCTION_NAMES } from '../../shared/formula.js';
import { debounceMs } from '../session.js';
import { focusFirst, openDialog } from '../ui/dialog.js';

export interface CalcDialogOptions {
  sheetId: string;
  opener: HTMLElement;
  calculation: { id: string; name: string; formula: string } | null;
  fieldNames: string[];
  queryOrder: string[];
  onSaved: (calculation: { id: string; name: string; formula: string }) => void;
}

interface CheckReply {
  valid: boolean;
  type?: string;
  aggregate?: boolean;
  message?: string;
  line?: number | null;
  column?: number | null;
}

export function openCalculationDialog(options: CalcDialogOptions): void {
  const dialog = openDialog({ name: 'Calculation', opener: options.opener });
  const nameInput = el('input', { type: 'text', id: 'calc-name', class: 'input', value: options.calculation?.name ?? '' });
  const formula = el('textarea', {
    id: 'calc-formula',
    class: 'input formula',
    rows: 4,
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'calc-suggestions',
  });
  formula.value = options.calculation?.formula ?? '';
  const suggestions = el('ul', { id: 'calc-suggestions', class: 'suggestions', 'aria-label': 'Suggestions', hidden: true });
  suggestions.setAttribute('role', 'listbox');
  const status = el('p', { role: 'status', 'aria-live': 'polite', 'aria-label': 'Formula check', class: 'status' });
  const save = el('button', { type: 'button', class: 'pill-button primary', text: 'Save calculation' });
  const steps = el('ol', { class: 'order-strip' },
    options.queryOrder.map((step) => el('li', { class: 'order-chip', text: step })),
  );

  dialog.body.append(
    el('label', { for: 'calc-name', text: 'Calculation name' }),
    nameInput,
    steps,
    el('label', { for: 'calc-formula', text: 'Formula' }),
    formula,
    suggestions,
    status,
    save,
  );

  let activeIndex = -1;
  let items: { name: string; isFunction: boolean }[] = [];
  let token: { start: number; bracket: boolean } | null = null;
  let checkToken = 0;
  let timer = 0;

  const closeList = (): void => {
    suggestions.hidden = true;
    formula.setAttribute('aria-expanded', 'false');
    formula.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    items = [];
    token = null;
  };

  const paint = (): void => {
    clear(suggestions);
    items.forEach((item, index) => {
      const option = el('li', {
        role: 'option',
        id: `suggestion-${index}`,
        'aria-selected': index === activeIndex ? 'true' : 'false',
        class: index === activeIndex ? 'active' : null,
        text: item.name,
      });
      suggestions.append(option);
    });
    if (activeIndex >= 0) formula.setAttribute('aria-activedescendant', `suggestion-${activeIndex}`);
    else formula.removeAttribute('aria-activedescendant');
  };

  /** Where the typed word ends. A caret reading 0 over text means the text was just inserted at the end. */
  const caretOf = (): number => {
    const start = formula.selectionStart;
    if (start === null) return formula.value.length;
    return start === 0 && formula.value.length > 0 ? formula.value.length : start;
  };

  const openList = (): void => {
    const caret = caretOf();
    const before = formula.value.slice(0, caret);
    const bracket = /\[([^\]]*)$/.exec(before);
    if (bracket !== null) {
      const prefix = bracket[1].toLowerCase();
      items = options.fieldNames
        .filter((name) => name.toLowerCase().startsWith(prefix))
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, isFunction: false }));
      token = { start: caret - bracket[1].length - 1, bracket: true };
    } else {
      const word = /([A-Za-z_][A-Za-z0-9_]*)$/.exec(before);
      if (word === null) {
        closeList();
        return;
      }
      const prefix = word[1].toLowerCase();
      items = [
        ...FUNCTION_NAMES.filter((name) => name.toLowerCase().startsWith(prefix))
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ name, isFunction: true })),
        ...options.fieldNames
          .filter((name) => name.toLowerCase().startsWith(prefix))
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ name, isFunction: false })),
      ];
      token = { start: caret - word[1].length, bracket: false };
    }
    if (items.length === 0) {
      closeList();
      return;
    }
    suggestions.hidden = false;
    formula.setAttribute('aria-expanded', 'true');
    activeIndex = 0;
    paint();
  };

  const insert = (): void => {
    if (token === null || activeIndex < 0 || items[activeIndex] === undefined) return;
    const item = items[activeIndex];
    const caret = caretOf();
    const text = item.isFunction ? `${item.name}(` : `[${item.name}]`;
    formula.value = formula.value.slice(0, token.start) + text + formula.value.slice(caret);
    const position = token.start + text.length;
    formula.setSelectionRange(position, position);
    closeList();
    scheduleCheck();
  };

  const scheduleCheck = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void runCheck();
    }, debounceMs());
  };

  const runCheck = async (): Promise<void> => {
    checkToken += 1;
    const mine = checkToken;
    const res = await send<CheckReply>('POST', '/api/formula/check', {
      sheet: options.sheetId,
      formula: formula.value,
    });
    if (mine !== checkToken || res.status !== 200) return;
    status.textContent = res.data.valid ? 'Formula is valid.' : res.data.message ?? '';
  };

  formula.addEventListener('input', () => {
    openList();
    scheduleCheck();
  });

  formula.addEventListener('keydown', (event) => {
    if (suggestions.hidden) {
      if (event.key === 'Escape') return;
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeIndex = Math.min(items.length - 1, activeIndex + 1);
      paint();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      paint();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      insert();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeList();
      return;
    }
    if (event.key === 'Tab') {
      closeList();
    }
  });

  save.addEventListener('click', () => {
    void (async () => {
      const body = { name: nameInput.value, formula: formula.value };
      const res =
        options.calculation === null
          ? await send<{ id: string; name: string; formula: string } & ApiErrorBody>(
              'POST',
              `/api/sheets/${options.sheetId}/calculations`,
              body,
            )
          : await send<{ id: string; name: string; formula: string } & ApiErrorBody>(
              'PUT',
              `/api/calculations/${options.calculation.id}`,
              body,
            );
      if (res.status === 200 || res.status === 201) {
        dialog.close();
        options.onSaved(res.data);
        return;
      }
      const errors = fieldErrors(res.data);
      status.textContent = errors.formula ?? errors.name ?? 'Something went wrong. Try again.';
    })();
  });

  focusFirst(dialog);
  void runCheck();
}
