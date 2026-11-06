import { ERROR_COPY, PENDING_COPY, STATE_COPY, SUCCESS_COPY } from '../../shared/copy';
import { get, postForm, RequestFailed } from '../api';
import { button, definition, element, heading } from '../dom';
import { showCountdown, showCrypto } from '../format';
import { Cleanup, RouteContext } from '../router';
import { problemsSummary, radioGroup, longTextField } from '../ui/fields';
import { ActionNote, StatusRegion } from '../ui/live';
import { keepClearOfBar } from '../ui/sticky';

interface PageBody {
  page: {
    caseReference: string;
    asset: string;
    amount: string;
    fromAddressMasked: string;
    toAddressMasked: string;
    requestingExchange: string;
    status: 'live' | 'answered';
    endsAt: string;
    remainingSeconds: number;
    now: string;
  };
}

export async function requestPageScreen(
  host: HTMLElement,
  context: RouteContext,
): Promise<Cleanup> {
  const token = context.params.token;
  const status = new StatusRegion('Request status');
  const note = new ActionNote(status);
  const problems = problemsSummary();
  const countdown = element('p', {
    className: 'countdown mono',
    attributes: { role: 'timer', 'aria-label': 'Page countdown' },
  });
  const stateText = element('p', { className: 'page-state' });
  const facts = element('div', { className: 'facts' });
  const main = element('main', { className: 'request-main' });
  const answer = radioGroup('Answer', 'answer', [
    { value: 'accepted', label: 'Accepted' },
    { value: 'rejected', label: 'Rejected' },
  ], 'accepted');
  const noteField = longTextField('Note', 'note');
  const fileInput = element('input', {
    className: 'visually-hidden',
    attributes: { type: 'file', 'aria-label': 'Licence certificate', accept: 'image/png,image/jpeg,image/webp' },
  });
  const chosen = element('p', { className: 'chosen-file mono' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0] ?? null;
    chosen.textContent = file === null ? '' : file.name;
  });
  const chooseButton = button('Choose certificate', () => fileInput.click());
  const sendButton = button('Send answer', () => void send(), { className: 'control primary' });
  const stickyBar = element('div', { className: 'sticky-bar', children: [sendButton] });
  const form = element('form', {
    className: 'panel request-form',
    children: [problems.node, answer.node, chooseButton, fileInput, chosen, noteField.node, note.node],
  });
  form.addEventListener('submit', (event) => event.preventDefault());

  const showEnded = (copy: string): void => {
    stateText.textContent = copy;
    countdown.textContent = '';
    form.setAttribute('hidden', 'hidden');
    stickyBar.setAttribute('hidden', 'hidden');
  };

  const paint = (body: PageBody['page']): void => {
    facts.replaceChildren(
      definition('Case reference', element('span', { text: body.caseReference, className: 'mono' })),
      definition('Asset and amount', element('span', { text: showCrypto(body.asset, body.amount), className: 'mono' })),
      definition('From address', element('span', { text: body.fromAddressMasked, className: 'mono' })),
      definition('To address', element('span', { text: body.toAddressMasked, className: 'mono' })),
      definition('Requesting exchange', body.requestingExchange),
    );
    if (body.status === 'answered') {
      stateText.textContent = STATE_COPY.requestPageAnswered;
      countdown.textContent = '';
      form.setAttribute('hidden', 'hidden');
      stickyBar.setAttribute('hidden', 'hidden');
      return;
    }
    form.removeAttribute('hidden');
    stickyBar.removeAttribute('hidden');
    stateText.textContent = STATE_COPY.requestPageLive(showCountdown(body.remainingSeconds));
    countdown.textContent = showCountdown(body.remainingSeconds);
  };

  const send = async (): Promise<void> => {
    problems.clear();
    note.say(PENDING_COPY.sendAnswer, 'pending');
    const form_data = new FormData();
    form_data.set('answer', answer.value());
    form_data.set('note', noteField.control.value);
    const file = fileInput.files?.[0] ?? null;
    if (file !== null) form_data.set('certificate', file, file.name);
    try {
      await postForm(`/api/request-pages/${token}/answer`, form_data);
      note.say(SUCCESS_COPY.sendAnswer);
      stateText.textContent = STATE_COPY.requestPageAnswered;
      form.setAttribute('hidden', 'hidden');
      stickyBar.setAttribute('hidden', 'hidden');
    } catch (error) {
      if (error instanceof RequestFailed) {
        note.say(error.failure.message, 'refused');
        if (Object.keys(error.failure.fields).length > 0) {
          problems.show(error.failure.fields, [noteField]);
        } else {
          problems.showOne(error.failure.message);
        }
        return;
      }
      note.say(ERROR_COPY.storage_unreachable, 'refused');
    }
  };

  host.append(
    element('div', {
      className: 'request-page',
      children: [
        element('header', {
          className: 'public-header',
          children: [element('span', { text: 'Lanternline', className: 'wordmark' })],
        }),
        status.node,
        main,
        stickyBar,
      ],
    }),
  );
  main.append(
    heading(1, 'Travel Rule data request', 'public-title'),
    facts,
    countdown,
    stateText,
    form,
  );

  const refresh = async (): Promise<void> => {
    try {
      const body = await get<PageBody>(`/api/request-pages/${token}`);
      paint(body.page);
    } catch (error) {
      if (error instanceof RequestFailed && error.failure.status === 410) {
        showEnded(error.failure.message);
        return;
      }
      if (error instanceof RequestFailed && error.failure.status === 404) {
        showEnded(STATE_COPY.unknownPage);
      }
    }
  };

  const releaseBar = keepClearOfBar(main, stickyBar);
  await refresh();
  const timer = window.setInterval(() => {
    void refresh();
  }, 5000);
  return () => {
    window.clearInterval(timer);
    releaseBar();
  };
}
