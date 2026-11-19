import { api } from '../api.js';
import { el } from '../dom.js';
import { fieldError } from '../dialog.js';
import { say } from '../status.js';
import { UI_COPY } from '../../shared/copy.js';
import { pendingJoin, setAccount, setPendingJoin } from '../runtime.js';
import { navigate } from '../router.js';
import { startLiveStream } from '../live.js';

let codeOfPendingSession: string | null = null;

const normalise = (code: string): string => code.replace(/[\s-]/g, '').toUpperCase();

export const joinPage = (main: HTMLElement): void => {
  const form = el('form', { class: 'qy-form', novalidate: true });
  const code = el('input', { id: 'join-code', class: 'qy-input qy-code-input', 'aria-label': 'Class code', autocomplete: 'off' });
  const nickname = el('input', { id: 'join-nickname', class: 'qy-input', 'aria-label': 'Nickname', autocomplete: 'off' });
  const submit = el('button', { type: 'submit', class: 'qy-pill qy-pill-solid', text: 'Join class' });
  form.append(
    el('div', { class: 'qy-field' }, [el('label', { for: 'join-code', text: 'Class code' }), code]),
    el('div', { class: 'qy-field' }, [el('label', { for: 'join-nickname', text: 'Nickname' }), nickname]),
    submit,
  );

  const join = async (): Promise<void> => {
    fieldError(code, null);
    fieldError(nickname, null);
    const typed = normalise(code.value);
    submit.disabled = true;
    try {
      const skipCodeStep = pendingJoin() !== null && codeOfPendingSession === typed;
      if (!skipCodeStep) {
        const codeResult = await api.joinCode(code.value);
        if (!codeResult.ok) {
          fieldError(code, codeResult.message);
          say(codeResult.message);
          return;
        }
        codeOfPendingSession = typed;
        setPendingJoin({ classroomName: codeResult.value.classroom.name });
      }
      const nicknameResult = await api.joinNickname(nickname.value);
      if (!nicknameResult.ok) {
        const message = nicknameResult.fields?.nickname ?? nicknameResult.message;
        if (nicknameResult.code === 'nickname_taken' || nicknameResult.fields?.nickname) {
          fieldError(nickname, message);
        } else {
          fieldError(code, message);
        }
        say(message);
        return;
      }
      const classroomName = pendingJoin()?.classroomName ?? '';
      setAccount(nicknameResult.value.account);
      setPendingJoin(null);
      codeOfPendingSession = null;
      startLiveStream();
      say(UI_COPY.joined(classroomName, nicknameResult.value.account.nickname ?? ''));
      navigate('/class');
    } finally {
      submit.disabled = false;
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void join();
  });

  main.append(
    el('div', { class: 'qy-centre' }, [
      el('section', { class: 'qy-card qy-auth-card' }, [
        el('h1', { class: 'qy-card-heading', text: 'Join your class' }),
        el('p', { class: 'qy-muted', text: 'Type the code on the board and the nickname your instructor gave you.' }),
        form,
      ]),
    ]),
  );
};
