/**
 * `/c/<token>`: the answer sheet and the sign-off, in the client's language.
 * Every string already came from the server, so nothing here is translated.
 */
import { c, cFill, type ClientCopyId } from '../../shared/clientCopy.ts';
import type { Language } from '../../shared/language.ts';
import { grainSwatch } from '../../shared/drawings.ts';
import { api, ApiError } from '../ui/api.ts';
import { DURATION, animate } from '../ui/motion.ts';
import { el, find, need, setText } from '../ui/dom.ts';
import { announce, showProblems, withPending } from '../ui/shell.ts';
import { field, openModal } from '../ui/dialog.ts';
import { setQuery } from '../router.ts';
import { REFRESH_MS } from './deskShell.ts';

export function startClientPage(): void {
  const root = find<HTMLElement>('.client-page');
  if (!root) return;
  const token = root.dataset.token ?? '';
  const language = (root.dataset.language ?? 'en') as Language;
  const town = root.dataset.town ?? 'Turin';
  let estimateId = root.dataset.estimate ?? '';

  const say = (id: ClientCopyId): string => c(id, language);

  // The chosen material's drawing, from the one dot primitive.
  const cover = find<HTMLElement>('.cover-drawing');
  if (cover) cover.innerHTML = grainSwatch(`${token}-cover`, 'sqFt');

  // ------------------------------------------------------------- the slider

  const slider = find<HTMLInputElement>('#compare-slider');
  const compare = find<HTMLElement>('[data-part="compare"]');
  if (slider && compare) {
    const apply = (): void => {
      const value = Number(slider.value);
      compare.style.setProperty('--share', `${value}%`);
      slider.setAttribute('aria-valuetext', cFill('C29', language, { n: String(value) }));
      setQuery({ before: String(value) }, true);
    };
    slider.addEventListener('input', apply);
    slider.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 10 : 1;
      const rtl = document.documentElement.dir === 'rtl';
      let value = Number(slider.value);
      if (event.key === 'ArrowLeft') value += rtl ? step : -step;
      else if (event.key === 'ArrowRight') value += rtl ? -step : step;
      else if (event.key === 'ArrowDown') value -= step;
      else if (event.key === 'ArrowUp') value += step;
      else return;
      event.preventDefault();
      slider.value = String(Math.min(100, Math.max(0, value)));
      apply();
      animate(compare, [{ opacity: 0.94 }, { opacity: 1 }], DURATION.quick);
    });
    const atStart = new URL(window.location.href).searchParams.get('before');
    if (atStart !== null) slider.value = atStart;
    apply();
  }

  // ------------------------------------------------------------- the sheet

  const open = need<HTMLButtonElement>('#your-answer');
  open.addEventListener('click', () => {
    openModal({
      name: say('C06'),
      opener: open,
      problemsName: say('C26'),
      build(sheetBody, handle) {
        const height = el('input', { type: 'text', name: 'seatHeight', inputmode: 'decimal' });
        const sendAnswer = el('button', { type: 'button', class: 'button-primary', text: say('C09') });
        const name = el('input', { type: 'text', name: 'typedName', autocomplete: 'name' });
        const approve = el('button', { type: 'button', class: 'button-primary', text: say('C11') });
        const close = el('button', { type: 'button', text: say('C12') });

        sheetBody.append(
          el('p', { text: say('C07') }),
          field('answer-height', say('C08'), height),
          el('p', {}, [sendAnswer]),
          field('answer-name', say('C10'), name),
          el('p', {}, [approve]),
          el('p', { class: 'dialog-actions' }, [close]),
        );

        close.addEventListener('click', () => handle.close());

        // `Send my answer` and the sign-off button act separately.
        sendAnswer.addEventListener('click', () => {
          void withPending(
            sendAnswer,
            async () => {
              try {
                await api.post(`/api/client-pages/${token}/answer`, { seatHeight: height.value });
                announce(say('C15'));
                await refresh();
              } catch (error) {
                if (!(error instanceof ApiError)) {
                  announce(say('C52'));
                  return;
                }
                const problems = Object.entries(error.failure.fields).map(([key, message]) => ({
                  field: key,
                  message,
                }));
                showProblems(
                  handle.problems,
                  problems.length > 0 ? problems : [{ field: 'seatHeight', message: error.failure.message }],
                  () => height,
                  say('C26'),
                );
              }
            },
            say('C22'),
          );
        });

        approve.addEventListener('click', () => {
          void withPending(
            approve,
            async () => {
              try {
                await api.post(`/api/client-pages/${token}/sign-off`, {
                  estimateId,
                  typedName: name.value,
                });
                handle.close();
                await refresh();
              } catch (error) {
                if (!(error instanceof ApiError)) {
                  announce(say('C52'));
                  return;
                }
                const problems = Object.entries(error.failure.fields).map(([key, message]) => ({
                  field: key,
                  message,
                }));
                if (problems.length > 0) {
                  showProblems(handle.problems, problems, () => name, say('C26'));
                } else {
                  announce(error.failure.message);
                }
              }
            },
            say('C22'),
          );
        });
      },
    });
  });

  // ------------------------------------------------------------- the refresh

  interface Page {
    estimateId: string | null;
    answer: { seatHeightCm: string } | null;
    signOff: { typedName: string; at: string } | null;
  }

  async function refresh(): Promise<void> {
    try {
      const answer = (await api.get(`/api/client-pages/${token}`)) as { page: Page };
      estimateId = answer.page.estimateId ?? '';
      root!.dataset.estimate = estimateId;
      setText(need<HTMLElement>('#refresh-state'), '');

      let answered = find<HTMLElement>('.answered');
      if (answer.page.answer) {
        if (!answered) {
          answered = el('p', { class: 'tile answered' });
          root!.append(answered);
        }
        setText(answered, `${c('C15', language)} ${answer.page.answer.seatHeightCm}`);
      }
      let signed = find<HTMLElement>('.signed');
      if (answer.page.signOff) {
        if (!signed) {
          signed = el('p', { class: 'tile signed' });
          root!.append(signed);
        }
        const at = new Date(answer.page.signOff.at);
        const time = new Intl.DateTimeFormat('en-GB', {
          timeZone: TOWN_ZONES[town] ?? 'Europe/Rome',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(at);
        setText(signed, cFill('C16', language, { time, town: root!.querySelector('.town')?.textContent ?? town }));
      }
    } catch (error) {
      if (error instanceof ApiError && error.failure.status === 410) {
        window.location.reload();
        return;
      }
      // One failed refresh leaves everything where it is and shows one line.
      setText(need<HTMLElement>('#refresh-state'), c('C21', language));
    }
  }

  const timer = window.setInterval(() => {
    void refresh();
  }, REFRESH_MS);
  window.addEventListener('pagehide', () => window.clearInterval(timer));
}

const TOWN_ZONES: Record<string, string> = {
  Turin: 'Europe/Rome',
  London: 'Europe/London',
  'New York': 'America/New_York',
  Kyoto: 'Asia/Tokyo',
  Dubai: 'Asia/Dubai',
};
