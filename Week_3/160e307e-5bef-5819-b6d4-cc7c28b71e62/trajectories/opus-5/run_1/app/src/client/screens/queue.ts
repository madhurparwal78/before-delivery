import { api } from '../api.js';
import { clear, el, elapsed } from '../dom.js';
import { navigate, onLeave } from '../router.js';
import { Socket } from '../socket.js';
import { refreshMe, state } from '../store.js';
import { bandFor } from '../../shared/queue.js';

interface QueueStatus {
  mode: 'casual' | 'ranked';
  near: number;
  band: { low: number; high: number } | null;
  waitedSeconds: number;
  matchId: string | null;
}

function radar(): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('id', 'radar');
  node.setAttribute('viewBox', '0 0 100 100');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML =
    '<circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2"/>' +
    '<circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"/>' +
    '<g class="sweep"><line x1="50" y1="50" x2="50" y2="4" stroke="currentColor" stroke-width="4"/></g>';
  return node;
}

export async function renderQueue(params: Record<string, string>, view: HTMLElement): Promise<void> {
  await refreshMe();
  const mode = params.mode === 'ranked' ? 'ranked' : 'casual';
  let status: QueueStatus;
  try {
    status = await api.get<QueueStatus>('/api/queue');
  } catch {
    navigate('/', true);
    return;
  }

  const near = el('div', { id: 'queue-near', text: `Looking for players near ${status.near}` });
  const band = el('div', { id: 'queue-band' });
  const elapsedNode = el('div', { id: 'queue-elapsed', class: 'num' });
  const cancel = el('button', { type: 'button', text: 'Cancel' });

  let waited = status.waitedSeconds;
  const near0 = status.near;

  function paintReadouts(): void {
    near.textContent = `Looking for players near ${near0}`;
    if (mode === 'casual') {
      band.textContent = 'Any rating';
    } else {
      const current = bandFor(near0, waited, state.config.bandWidenSeconds);
      band.textContent = `Rating band: ${current.low}-${current.high}`;
    }
    elapsedNode.textContent = elapsed(waited);
  }

  function paint(next: QueueStatus): void {
    waited = next.waitedSeconds;
    paintReadouts();
    if (next.matchId !== null) {
      leave();
      navigate(`/match/${next.matchId}`);
    }
  }

  const started = performance.now() - status.waitedSeconds * 1000;
  const ticker = window.setInterval(() => {
    waited = Math.floor((performance.now() - started) / 1000);
    paintReadouts();
  }, 200);

  const socket = new Socket(() => '');
  socket.on((message) => {
    if (message.type === 'queueStatus') paint(message as unknown as QueueStatus);
    if (message.type === 'matchFound' && typeof message.matchId === 'string') {
      leave();
      navigate(`/match/${message.matchId}`);
    }
  });
  socket.open();

  function leave(): void {
    window.clearInterval(ticker);
    socket.close();
    document.removeEventListener('keydown', onKey);
  }

  function quit(): void {
    void api.del('/api/queue').catch(() => undefined);
    leave();
    navigate('/');
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    quit();
  };
  document.addEventListener('keydown', onKey);
  cancel.addEventListener('click', () => quit());
  onLeave(leave);

  clear(view);
  view.append(
    el('section', { class: `field field--${mode === 'ranked' ? 'cobalt' : 'tomato'}`, style: 'min-height:100vh' }, [
      el('h1', { class: 'display', text: 'Finding a match', style: 'font-size: var(--step-4)' }),
      el('div', { class: 'stack', style: 'margin-top:1.5rem' }, [
        near,
        band,
        elapsedNode,
        radar(),
        el('div', { class: 'row' }, [cancel]),
      ]),
    ]),
  );
  paint(status);
}
