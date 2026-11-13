import { formatTimestamp } from '../../shared/clock.js';
import { TONIGHT_COPY } from '../../shared/messages.js';
import { defaultOptics } from '../../shared/optics.js';
import { internalLink, workingScreen } from '../chrome.js';
import { viewSessions } from '../derive.js';
import { el, labelledField, select, setStatus } from '../dom.js';
import { enqueue } from '../journal.js';
import { prefetchAccount } from '../prefetch.js';
import { regions } from '../regions.js';
import { navigate } from '../router.js';
import { appState, subscribe } from '../state.js';
import { sendSoon } from '../sync.js';
import { onLeaveScreen } from '../router.js';

function sessionRow(session: {
  id: string;
  evening_date: string;
  site: { name: string };
  observation_count: number;
}): HTMLElement {
  return el('li', { class: 'row' }, [
    internalLink(`${session.evening_date} · ${session.site.name}`, `/sessions/${session.id}`, 'row-link'),
    el('span', {
      class: 'row-detail',
      text:
        session.observation_count === 1
          ? '1 observation'
          : `${session.observation_count} observations`,
    }),
  ]);
}

export async function renderTonight(): Promise<HTMLElement> {
  const { root, content } = workingScreen('Tonight');
  const status = el('div', {
    class: 'status-line',
    attrs: { role: 'status', 'aria-label': 'Tonight status', 'aria-live': 'polite' },
  });
  regions.tonightStatus = status;

  const { copy } = appState();
  const sitePicker = select(
    'Site',
    copy.sites.map((site) => ({ value: site.id, label: site.name })),
    copy.sites[0]?.id ?? null,
  );
  const start = el('button', {
    class: 'button accent',
    text: 'Start session',
    attrs: { type: 'submit' },
  });
  const form = el('form', { class: 'form' }, [labelledField('Site', sitePicker), start]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const state = appState();
      const kit = state.copy.kit;
      const optics = kit ? defaultOptics(kit) : null;
      if (!optics) {
        setStatus(status, TONIGHT_COPY.no_optics);
        return;
      }
      const siteId = sitePicker.value;
      if (!siteId) {
        setStatus(status, TONIGHT_COPY.no_site);
        return;
      }
      setStatus(status, '');
      const sessionId = crypto.randomUUID();
      await enqueue(
        {
          client_op_id: crypto.randomUUID(),
          kind: 'session.create',
          session_id: sessionId,
          site_id: siteId,
          started_at: formatTimestamp(new Date()),
          optics,
        },
        { session_id: sessionId },
      );
      sendSoon();
      navigate(`/sessions/${sessionId}`);
    })();
  });

  const list = el('ul', { class: 'list', attrs: { 'aria-label': 'Your sessions' } });
  const paint = (): void => {
    list.replaceChildren(...viewSessions().map(sessionRow));
  };
  paint();
  const unsubscribe = subscribe(paint);
  onLeaveScreen(unsubscribe);

  content.append(form, status, list);
  void prefetchAccount().then(paint);
  return root;
}
