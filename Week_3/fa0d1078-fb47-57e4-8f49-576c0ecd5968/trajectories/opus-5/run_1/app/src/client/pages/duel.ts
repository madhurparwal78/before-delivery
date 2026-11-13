import type { HealthShape, RoomShape } from '../../shared/api';
import { M } from '../../shared/messages';
import { LEVELS, LEVEL_NAMES, type Level } from '../../shared/puzzles';
import { api, ApiFailure } from '../api';
import { announce } from '../announcer';
import { button, el, text } from '../dom';
import type { PageContext } from '../main';
import { navigate, noticeFor } from '../main';
import { pending } from '../pending';

export async function renderDuel(context: PageContext): Promise<void> {
  const { main } = context;
  main.append(text('h1', 'Duel'));

  let level: Level = 'easy';
  const group = el('fieldset', { role: 'radiogroup', 'aria-label': 'Level', class: 'level-group' });
  for (const option of LEVELS) {
    const radio = el('input', {
      type: 'radio',
      name: 'duel-level',
      value: option,
      'aria-label': LEVEL_NAMES[option],
      checked: option === 'easy',
    });
    radio.addEventListener('change', () => {
      level = option;
    });
    group.append(el('label', { class: 'level-radio' }, [radio, LEVEL_NAMES[option]]));
  }

  const create = button('Create room', { class: 'primary' });
  const codeField = el('input', { type: 'text', id: 'room-code', autocomplete: 'off' });
  const codeError = el('p', { class: 'field-error', id: 'room-code-error' });
  const join = button('Join room', { class: 'primary' });
  const notice = el('p', { id: 'duel-notice', class: 'notice' });

  codeField.setAttribute('aria-label', 'Room code');
  codeField.setAttribute('aria-describedby', 'room-code-error');
  codeField.addEventListener('input', () => {
    codeField.value = codeField.value.replace(/[\s-]/g, '').toUpperCase();
  });
  codeField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      join.click();
    }
  });

  main.append(
    el('div', { class: 'tile duel-tile' }, [
      group,
      create,
      el('label', { class: 'field', for: 'room-code' }, ['Room code', codeField]),
      codeError,
      join,
    ]),
    notice,
  );

  create.addEventListener('click', () => {
    void pending(create, M.pendingRoom, async () => {
      try {
        const answer = await api.post<{ room: RoomShape }>('/api/duels', { level });
        navigate(`/duel/${answer.room.code}`);
      } catch (cause) {
        show(cause);
      }
    });
  });

  join.addEventListener('click', () => {
    void pending(join, M.pendingRoom, async () => {
      try {
        const answer = await api.post<{ room: RoomShape }>('/api/duels/join', {
          code: codeField.value,
        });
        navigate(`/duel/${answer.room.code}`);
      } catch (cause) {
        show(cause);
      }
    });
  });

  function show(cause: unknown): void {
    const sentence = noticeFor(cause);
    if (cause instanceof ApiFailure && cause.code === 'LIVE_UNAVAILABLE') {
      notice.textContent = sentence;
      announce(sentence);
      return;
    }
    codeError.textContent = sentence;
    announce(sentence);
  }

  try {
    const health = await api.get<HealthShape>('/api/health');
    if (health.down?.includes('valkey')) {
      notice.textContent = M.liveUnavailable;
      announce(M.liveUnavailable);
      create.disabled = true;
      join.disabled = true;
    }
  } catch {
    /* solo play keeps working whatever the health check says */
  }
}
