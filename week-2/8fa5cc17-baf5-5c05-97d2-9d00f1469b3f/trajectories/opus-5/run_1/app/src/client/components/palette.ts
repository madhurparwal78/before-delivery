import { api } from '../api';
import { clear, el } from '../dom';
import { openDialog } from './dialog';
import { SearchResultDto } from '../types';
import { commandList, rankCommands } from '../../shared/search';
import { paletteStatusCopy } from '../../shared/copy';
import { SEARCH_DEBOUNCE_MS } from '../../shared/motion';
import { theme } from '../state';
import { navigate } from '../router';
import { setTheme } from '../state';
import { frame } from '../frame';
import { themeLabel } from '../../shared/tokens';
import { themeSavedCopy } from '../../shared/copy';

/** The command palette: commands by the published fuzzy score and notes for the latest search. */
export function openPalette(opener: HTMLElement | null): void {
  let commands: string[] = commandList(theme());
  let notes: SearchResultDto[] = [];
  let active = 0;
  let sequence = 0;
  let answered = -1;
  let timer = 0;

  const search = el('input', {
    className: 'palette-search',
    attrs: { type: 'text', role: 'combobox', 'aria-label': 'Search Quire', 'aria-expanded': 'true', autocomplete: 'off' },
  });
  const commandGroup = el('div', { className: 'palette-group', attrs: { role: 'group', 'aria-label': 'Commands' } });
  const noteGroup = el('div', { className: 'palette-group', attrs: { role: 'group', 'aria-label': 'Notes' } });
  const list = el('div', {
    className: 'palette-list',
    attrs: { role: 'listbox', 'aria-label': 'Palette results' },
    children: [commandGroup, noteGroup],
  });
  const status = el('div', {
    className: 'palette-status',
    attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Palette status' },
  });
  const error = el('div', { className: 'palette-error' });

  const handle = openDialog({
    label: 'Command palette',
    className: 'palette',
    opener,
    content: () => [search, list, error, status],
    onClose: () => {
      if (timer !== 0) window.clearTimeout(timer);
    },
  });

  function options(): HTMLElement[] {
    return [...list.querySelectorAll<HTMLElement>('.palette-option')];
  }

  function render(): void {
    clear(commandGroup);
    clear(noteGroup);
    commands.forEach((command) => {
      const option = el('div', {
        className: 'palette-option',
        text: command,
        attrs: { role: 'option', 'aria-selected': 'false', tabindex: '-1' },
      });
      option.addEventListener('click', () => runCommand(command));
      commandGroup.append(option);
    });
    notes.forEach((note) => {
      const option = el('div', {
        className: 'palette-option',
        attrs: { role: 'option', 'aria-selected': 'false', tabindex: '-1' },
      });
      option.setAttribute('aria-label', `${note.title}, ${note.type_name}`);
      option.append(el('span', { className: 'palette-title', text: `${note.title}, ${note.type_name}` }));
      const snippetId = `palette-snippet-${note.object_id}`;
      const snippet = el('span', { className: 'palette-snippet', attrs: { id: snippetId } });
      for (const segment of note.snippet) {
        snippet.append(segment.match ? el('mark', { text: segment.text }) : el('span', { text: segment.text }));
      }
      option.append(snippet);
      option.setAttribute('aria-describedby', snippetId);
      option.addEventListener('click', () => {
        handle.close();
        navigate(`/o/${note.object_id}`);
      });
      noteGroup.append(option);
    });
    const all = options();
    all.forEach((option, index) => option.setAttribute('aria-selected', index === active ? 'true' : 'false'));
    status.textContent = paletteStatusCopy(commands.length, notes.length);
  }

  function runCommand(command: string): void {
    handle.close();
    if (command === 'Go to Today') {
      navigate('/today', { reveal: true });
      return;
    }
    if (command === 'Open graph') {
      navigate('/graph');
      return;
    }
    if (command === 'Open timeline') {
      navigate('/timeline');
      return;
    }
    if (command === 'Open queries') {
      navigate('/queries');
      return;
    }
    if (command === 'Open settings') {
      navigate('/settings');
      return;
    }
    if (command === 'New type') {
      document.dispatchEvent(new CustomEvent('quire:new-type', { detail: { opener: null } }));
      return;
    }
    const next = command === 'Switch to Lamplight' ? 'lamplight' : 'paper';
    void (async () => {
      const result = await api.put<{ theme: 'paper' | 'lamplight' }>('/api/settings', { theme: next });
      if (result.ok) {
        setTheme(result.data.theme);
        frame().announce(themeSavedCopy(themeLabel(result.data.theme)));
      }
    })();
  }

  function choose(): void {
    const all = options();
    const option = all[active];
    if (option === undefined) return;
    option.click();
  }

  async function searchNotes(text: string): Promise<void> {
    const mine = ++sequence;
    const result = await api.get<{ results: SearchResultDto[] }>(`/api/search?q=${encodeURIComponent(text)}`);
    if (mine < answered || search.value !== text) return;
    answered = mine;
    if (!result.ok) {
      error.textContent = result.errors?.['q'] ?? '';
      notes = [];
      render();
      return;
    }
    error.textContent = '';
    notes = result.data.results;
    active = 0;
    render();
  }

  search.addEventListener('input', () => {
    const text = search.value;
    commands = text.trim() === '' ? commandList(theme()) : rankCommands(commandList(theme()), text);
    active = 0;
    if (text.trim() === '') {
      notes = [];
      render();
      if (timer !== 0) window.clearTimeout(timer);
      return;
    }
    render();
    if (timer !== 0) window.clearTimeout(timer);
    timer = window.setTimeout(() => void searchNotes(text), SEARCH_DEBOUNCE_MS);
  });

  search.addEventListener('keydown', (event) => {
    const all = options();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (all.length > 0) active = (active + 1) % all.length;
      render();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (all.length > 0) active = (active - 1 + all.length) % all.length;
      render();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose();
    }
  });

  render();
}
