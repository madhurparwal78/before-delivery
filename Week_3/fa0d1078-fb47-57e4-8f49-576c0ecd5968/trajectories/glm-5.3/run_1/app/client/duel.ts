import { el, announce } from './dom.js';
import { api, ApiError } from './api.js';
import { LEVELS, LEVEL_NAMES, type Level } from '../shared/puzzles.js';
import * as M from '../shared/messages.js';

// The Duel page: the level choice, Create room, then the code field and
// Join room, stacked on one tile. When Valkey is unreachable, M40 shows and
// both buttons are disabled.

export async function renderDuelPage(): Promise<HTMLElement> {
  const h1 = el('h1', {}, ['Duel']);
  const page = el('div', { class: 'duel-form' });

  const notice = el('p', { id: 'duel-notice', class: 'form-result', role: 'status' }, []);
  const tile = el('div', { class: 'tile form-tile' });

  let level: Level = 'easy';
  const group = el('div', { class: 'radiogroup', role: 'radiogroup', 'aria-label': 'Level' });
  const radios: HTMLInputElement[] = [];
  for (const lvl of LEVELS) {
    const id = `level-${lvl}`;
    const input = el('input', { type: 'radio', id, name: 'level', value: lvl });
    if (lvl === 'easy') input.checked = true;
    const label = el('label', { for: id }, [input, LEVEL_NAMES[lvl]]);
    input.addEventListener('change', () => {
      level = lvl;
    });
    radios.push(input);
    group.append(label);
  }

  const createBtn = el('button', { class: 'button', type: 'button' }, ['Create room']);
  createBtn.addEventListener('click', async () => {
    createBtn.setAttribute('aria-disabled', 'true');
    announce(M.m59Room());
    try {
      const res = await api.post<{ room: { code: string } }>('/api/duels', { level });
      window.location.href = `/duel/${res.room.code}`;
    } catch (err) {
      createBtn.setAttribute('aria-disabled', 'false');
      if (err instanceof ApiError) {
        if (err.failure.code === 'NOT_VERIFIED') {
          announce(M.m27());
          fieldError.textContent = M.m27();
        } else if (err.failure.status >= 500) {
          announce(M.m56());
          fieldError.textContent = M.m56();
        } else {
          announce(M.m56());
        }
      }
    }
  });

  const codeField = el('div', { class: 'field' }, [
    el('label', { for: 'room-code' }, ['Room code']),
    el('input', { id: 'room-code', name: 'code', autocomplete: 'off', spellcheck: 'false' }),
  ]);
  const codeInput = codeField.querySelector('input') as HTMLInputElement;
  const fieldError = el('p', { class: 'field-error', id: 'duel-field-error' }, []);
  codeField.append(fieldError);

  // The code field accepts lower case letters, ignores spaces and hyphens,
  // and shows the code in upper case.
  codeInput.addEventListener('input', () => {
    const cleaned = codeInput.value.replace(/[\s-]/g, '').toUpperCase();
    if (cleaned !== codeInput.value) codeInput.value = cleaned;
  });

  const joinBtn = el('button', { class: 'button', type: 'button' }, ['Join room']);
  async function join(): Promise<void> {
    const code = codeInput.value.replace(/[\s-]/g, '').toUpperCase();
    joinBtn.setAttribute('aria-disabled', 'true');
    announce(M.m59Room());
    try {
      const res = await api.post<{ room: { code: string } }>('/api/duels/join', { code });
      window.location.href = `/duel/${res.room.code}`;
    } catch (err) {
      joinBtn.setAttribute('aria-disabled', 'false');
      if (err instanceof ApiError) {
        const code = err.failure.code;
        if (code === 'NOT_VERIFIED') {
          fieldError.textContent = M.m27();
          announce(M.m27());
        } else if (code === 'RATE_LIMITED') {
          fieldError.textContent = M.m28();
          announce(M.m28());
        } else if (code === 'ROOM_NOT_FOUND') {
          fieldError.textContent = M.m29();
          announce(M.m29());
        } else if (code === 'ROOM_FULL') {
          fieldError.textContent = M.m41();
          announce(M.m41());
        } else {
          fieldError.textContent = M.m56();
          announce(M.m56());
        }
      }
    }
  }
  joinBtn.addEventListener('click', join);
  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void join();
    }
  });

  // Valkey's health decides whether duels can start.
  try {
    const health = await api.get<{ status: string; down?: string[] }>('/api/health');
    if (health.down?.includes('valkey')) {
      notice.textContent = M.m40();
      announce(M.m40());
      createBtn.setAttribute('aria-disabled', 'true');
      joinBtn.setAttribute('aria-disabled', 'true');
    }
  } catch {
    notice.textContent = M.m40();
    announce(M.m40());
    createBtn.setAttribute('aria-disabled', 'true');
    joinBtn.setAttribute('aria-disabled', 'true');
  }

  tile.append(group, createBtn, codeField, joinBtn, notice);
  page.append(h1, tile);
  void radios;
  return page;
}
