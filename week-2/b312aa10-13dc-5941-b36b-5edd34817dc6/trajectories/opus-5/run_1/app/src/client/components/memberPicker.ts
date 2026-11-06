/** The operator's member picker: an editable type-ahead list that follows the latest typing. */
import { AbandonedError, get } from '../api.js';
import { el, on, replace } from '../dom.js';

export type MemberOption = { id: string; name: string; businessName: string };

export type Picker = {
  field: HTMLInputElement;
  listbox: HTMLElement;
  selectedId: () => string | null;
  setSelected: (option: MemberOption | null) => void;
  close: () => void;
};

export function optionName(member: MemberOption): string {
  return `${member.businessName} \u00b7 ${member.name}`;
}

export function memberPicker(): Picker {
  const listboxId = 'members-listbox';
  const field = el('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Member',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listboxId,
    autocomplete: 'off',
    class: 'picker-field',
  });
  const listbox = el('div', {
    role: 'listbox',
    'aria-label': 'Members',
    id: listboxId,
    class: 'picker-listbox',
    hidden: true,
  });

  let selected: MemberOption | null = null;
  let options: MemberOption[] = [];
  let activeIndex = -1;
  let queryToken = 0;
  let debounce: number | null = null;
  const held = new Map<string, MemberOption[]>();

  function open(): void {
    listbox.hidden = false;
    field.setAttribute('aria-expanded', 'true');
  }

  function close(): void {
    listbox.hidden = true;
    field.setAttribute('aria-expanded', 'false');
    field.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function drawOptions(): void {
    if (options.length === 0) {
      replace(listbox, el('p', { class: 'picker-empty', text: 'No members match.' }));
      field.removeAttribute('aria-activedescendant');
      return;
    }
    replace(
      listbox,
      options.map((member, index) => {
        const option = el('div', {
          role: 'option',
          id: `member-option-${index}`,
          class: `picker-option${index === activeIndex ? ' active' : ''}`,
          'aria-selected': index === activeIndex ? 'true' : 'false',
          text: optionName(member),
        });
        on(option, 'click', () => choose(index));
        return option;
      }),
    );
    if (activeIndex >= 0) {
      field.setAttribute('aria-activedescendant', `member-option-${activeIndex}`);
    } else {
      field.removeAttribute('aria-activedescendant');
    }
  }

  function choose(index: number): void {
    const member = options[index];
    if (!member) return;
    selected = member;
    field.value = optionName(member);
    held.set(field.value, [member]);
    close();
  }

  async function query(text: string, activateFirst: boolean): Promise<void> {
    queryToken += 1;
    const mine = queryToken;
    listbox.setAttribute('aria-busy', 'true');
    options = [];
    drawOptions();
    try {
      const result = await get<{ members: MemberOption[] }>(
        `/api/members?q=${encodeURIComponent(text)}`,
      );
      if (mine !== queryToken) return;
      held.set(text, result.body.members);
      options = result.body.members;
      activeIndex = activateFirst && options.length > 0 ? 0 : -1;
      drawOptions();
    } catch (error) {
      if (error instanceof AbandonedError) return;
      if (mine !== queryToken) return;
      options = [];
      drawOptions();
    } finally {
      if (mine === queryToken) listbox.removeAttribute('aria-busy');
    }
  }

  on(field, 'input', () => {
    selected = null;
    open();
    const text = field.value;
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = window.setTimeout(() => void query(text, false), 200);
  });

  on(field, 'keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (listbox.hidden) {
        open();
        const text = field.value;
        const cached = held.get(text);
        if (cached) {
          options = cached;
          activeIndex = options.length > 0 ? 0 : -1;
          drawOptions();
        } else {
          void query(text, true);
        }
        return;
      }
      if (activeIndex < options.length - 1) activeIndex += 1;
      else if (activeIndex === -1 && options.length > 0) activeIndex = 0;
      drawOptions();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (activeIndex > 0) activeIndex -= 1;
      drawOptions();
      return;
    }
    if (event.key === 'Enter') {
      if (!listbox.hidden && activeIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        choose(activeIndex);
      }
      return;
    }
    if (event.key === 'Escape') {
      if (!listbox.hidden) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      return;
    }
    if (event.key === 'Tab') close();
  });

  return {
    field,
    listbox,
    selectedId: () => selected?.id ?? null,
    setSelected: (option) => {
      selected = option;
      field.value = option === null ? '' : optionName(option);
      close();
    },
    close,
  };
}
