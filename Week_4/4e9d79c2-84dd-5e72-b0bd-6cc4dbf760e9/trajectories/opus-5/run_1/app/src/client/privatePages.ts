import { all, announce, api, one, pageData, whileWorking } from './dom.js';
import { closeDialog } from './dialogs.js';

type CustomerData = { token: string; language: 'en' | 'pl' | 'ur' };
type BidData = { token: string; vehicles: number };
type RunData = { token: string; language: 'en' | 'pl'; stops: string[] };

const QUEUE_KEY = 'wayticket-press-queue';

const PRESS_WORDS: Record<string, Record<string, string>> = {
  en: {
    arrived: 'Arrived',
    boarded: 'Boarded',
    left: 'Left',
    comfortStop: 'Comfort stop',
    backOnTheRoad: 'Back on the road',
  },
  pl: {
    arrived: 'Na miejscu',
    boarded: 'Wsiedli',
    left: 'Odjazd',
    comfortStop: 'Postój',
    backOnTheRoad: 'W trasie',
  },
};

export function startCustomerPage(): void {
  const data = pageData<CustomerData>();
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (action === 'confirm-acceptance') {
      void whileWorking(button, async () => {
        const name = one<HTMLInputElement>('#full-name')?.value ?? '';
        const answer = await api(`/api/q/${data.token}/accept`, { method: 'POST', body: { name } });
        const message = one<HTMLElement>('[data-message]');
        if (!answer.ok) {
          if (message) {
            message.textContent = answer.body.error.message;
            message.removeAttribute('hidden');
            message.setAttribute('tabindex', '-1');
            message.focus();
          }
          announce(answer.body.error.message);
          return;
        }
        closeDialog('accept-quote');
        window.location.reload();
      });
      return;
    }
    if (action === 'deposit-sent') {
      void whileWorking(button, async () => {
        const answer = await api(`/api/q/${data.token}/deposit-sent`, { method: 'POST', body: {} });
        if (!answer.ok) {
          announce(answer.body.error.message);
          return;
        }
        window.location.reload();
      });
    }
  });
  const chooser = one<HTMLSelectElement>('#language');
  chooser?.addEventListener('change', () => {
    window.location.assign(`/q/${data.token}?lang=${chooser.value}`);
  });
}

export function startBidPage(): void {
  const data = pageData<BidData>();
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!button) return;
    const action = button.getAttribute('data-action');
    if (action === 'send-price') {
      void whileWorking(button, async () => {
        const prices = all<HTMLInputElement>('[id^="price-"]').map((input) => input.value);
        const answer = await api<{ announcement?: string }>(`/api/b/${data.token}/bid`, {
          method: 'PUT',
          body: { prices },
        });
        if (!answer.ok) {
          announce(answer.body.error.message);
          return;
        }
        if (answer.body.announcement) announce(answer.body.announcement);
        window.location.reload();
      });
      return;
    }
    if (action === 'confirm-withdrawal') {
      void whileWorking(button, async () => {
        const answer = await api(`/api/b/${data.token}/bid`, { method: 'DELETE', body: {} });
        if (!answer.ok) {
          announce(answer.body.error.message);
          return;
        }
        announce('Bid withdrawn.');
        closeDialog('withdraw-bid');
        window.location.reload();
      });
    }
  });
}

type QueuedPress = { stopId: string; kind: string; repeatKey: string; madeAt: number };

function readQueue(): QueuedPress[] {
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? '[]') as QueuedPress[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedPress[]): void {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function startRunSheet(): void {
  const data = pageData<RunData>();
  const words = PRESS_WORDS[data.language] ?? PRESS_WORDS.en;
  const paintCount = (): void => {
    const count = readQueue().length;
    const line = one<HTMLElement>('[data-part="waiting-count"]');
    if (!line) return;
    line.textContent =
      count === 0
        ? data.language === 'pl'
          ? 'Wszystko wysłane'
          : 'All sent'
        : data.language === 'pl'
          ? `Do wysłania: ${count}`
          : `${count} waiting to send`;
  };

  let sending = false;
  const drain = async (): Promise<void> => {
    if (sending) return;
    sending = true;
    try {
      let queue = readQueue();
      while (queue.length > 0) {
        const press = queue[0];
        const secondsAgo = Math.max(0, Math.floor((Date.now() - press.madeAt) / 1000));
        const answer = await api(`/api/r/${data.token}/presses`, {
          method: 'POST',
          body: { stopId: press.stopId, kind: press.kind, secondsAgo, repeatKey: press.repeatKey },
        });
        if (!answer.ok && answer.status >= 500) break;
        queue = readQueue().slice(1);
        writeQueue(queue);
        paintCount();
      }
    } catch {
      paintCount();
    } finally {
      sending = false;
    }
  };

  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-press]');
    if (!button) return;
    const kind = button.getAttribute('data-press') as string;
    const stopId = button.getAttribute('data-stop') as string;
    const queue = readQueue();
    queue.push({
      stopId,
      kind,
      repeatKey: `${stopId}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      madeAt: Date.now(),
    });
    writeQueue(queue);
    button.dataset.done = 'true';
    paintCount();
    announce(data.language === 'pl' ? `Zapisano: ${words[kind]}.` : `${words[kind]} recorded.`);
    void drain();
  });

  const chooser = one<HTMLSelectElement>('#language');
  chooser?.addEventListener('change', () => {
    window.location.assign(`/r/${data.token}${chooser.value === 'pl' ? '?lang=pl' : ''}`);
  });

  window.addEventListener('online', () => {
    void drain();
  });
  paintCount();
  void drain();
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined);
  }
}
