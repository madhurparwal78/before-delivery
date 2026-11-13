import { api, ApiFailure } from '../api.js';
import { clear, el } from '../dom.js';
import { navigate } from '../router.js';
import { refreshMe } from '../store.js';
import { ROOM_CODE_LENGTH } from '../../shared/room.js';
import { topbar } from './shell.js';

function failurePage(code: string, view: HTMLElement): void {
  const heading =
    code === 'ROOM_FULL' ? 'Room full' : code === 'ROOM_CLOSED' ? 'This room has closed' : 'Room not found';
  const line = code === 'ROOM_FULL' ? 'This room already has two players.' : null;
  clear(view);
  view.append(
    el('div', {}, [
      topbar(),
      el('section', { class: 'field field--ground' }, [
        el('h1', { class: 'display', text: heading, style: 'font-size: var(--step-3)' }),
        ...(line === null ? [] : [el('p', { text: line })]),
        el('p', {}, [el('a', { href: '/', text: 'Home' })]),
      ]),
    ]),
  );
}

async function joinCode(code: string, view: HTMLElement): Promise<void> {
  try {
    await api.post(`/api/rooms/${code.toUpperCase()}/join`);
    navigate(`/room/${code.toUpperCase()}`);
  } catch (failure) {
    failurePage(failure instanceof ApiFailure ? failure.code : 'ROOM_NOT_FOUND', view);
  }
}

export async function renderJoinLink(params: Record<string, string>, view: HTMLElement): Promise<void> {
  const me = await refreshMe();
  const nameInput = el('input', { type: 'text', 'aria-label': 'Your name', value: me?.name ?? '', maxlength: '16' });
  const join = el('button', { type: 'submit', text: 'Join' });
  const form = el('form', { class: 'stack' }, [
    el('h1', { class: 'display', text: `Join ${params.code.toUpperCase()}`, style: 'font-size: var(--step-3)' }),
    el('div', {}, [el('label', { text: 'Your name' }), nameInput]),
    el('div', { class: 'row' }, [join]),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    join.disabled = true;
    void (async () => {
      if (nameInput.value !== me?.name && nameInput.value.length >= 3) {
        await api.post('/api/me/name', { name: nameInput.value }).catch(() => undefined);
      }
      await joinCode(params.code, view);
      join.disabled = false;
    })();
  });
  clear(view);
  view.append(el('div', {}, [topbar(), el('section', { class: 'field field--ground' }, [el('div', { class: 'sheet' }, [form])])]));
}

export async function renderJoinCode(_params: Record<string, string>, view: HTMLElement): Promise<void> {
  await refreshMe();
  const boxes: HTMLInputElement[] = [];
  const group = el('div', { role: 'group', 'aria-label': 'Room code', class: 'code-boxes' });

  const value = (): string => boxes.map((box) => box.value).join('');

  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    const box = el('input', {
      type: 'text',
      'aria-label': `Character ${index + 1} of 6`,
      maxlength: '1',
      autocomplete: 'off',
      inputmode: 'text',
    });
    box.addEventListener('input', () => {
      box.value = box.value.toUpperCase().slice(0, 1);
      if (box.value !== '' && index + 1 < ROOM_CODE_LENGTH) boxes[index + 1].focus();
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Backspace' && box.value === '' && index > 0) {
        event.preventDefault();
        boxes[index - 1].value = '';
        boxes[index - 1].focus();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void joinCode(value(), view);
      }
    });
    box.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = (event.clipboardData?.getData('text') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      boxes.forEach((target, position) => {
        target.value = text[position] ?? '';
      });
      boxes[Math.min(text.length, ROOM_CODE_LENGTH) - 1]?.focus();
    });
    boxes.push(box);
    group.append(box);
  }

  const join = el('button', { type: 'submit', text: 'Join' });
  const form = el('form', { class: 'stack' }, [
    el('h1', { class: 'display', text: 'Join with a code', style: 'font-size: var(--step-3)' }),
    group,
    el('div', { class: 'row' }, [join]),
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void joinCode(value(), view);
  });

  clear(view);
  view.append(el('div', {}, [topbar(), el('section', { class: 'field field--ground' }, [el('div', { class: 'sheet' }, [form])])]));
  boxes[0].focus();
}
