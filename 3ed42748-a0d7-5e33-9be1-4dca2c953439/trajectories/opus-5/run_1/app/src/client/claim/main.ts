import { ApiFault, request } from '../shared/api.js';
import { el } from '../shared/dom.js';
import { paperGround } from '../shared/paper.js';
import { Notices } from '../shared/notices.js';
import { copy } from '../game/copy.js';

interface Redeemed {
  role: string;
  display_name: string;
  balance: number;
  merged_guest: boolean;
  return_to: string;
}

const notices = new Notices();
const outcome = el('p', { class: 'claim-outcome' });
const actions = el('div', { class: 'claim-actions' });
const card = el('article', { class: 'stamp-card perforated claim-card' }, [
  el('h1', {}, ['Claim your save']),
  outcome,
  actions,
]);
paperGround(card);

const host = document.getElementById('claim-app')!;
host.append(notices.region, el('main', { class: 'claim-page' }, [card]));

/** The claim page reads only its own token and follows only the stored return path. */
function wayBack(label: string, path: string): void {
  const button = el('button', { type: 'button', class: 'primary' }, [label]);
  button.addEventListener('click', () => {
    window.location.assign(path);
  });
  actions.replaceChildren(button);
  button.focus();
}

async function redeem(): Promise<void> {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  notices.say(copy.redeem.pending);
  try {
    const answer = await request<Redeemed>('POST', '/api/auth/redeem', { json: { token } });
    notices.say(copy.redeem.success);
    outcome.textContent = `${copy.redeem.success} You are signed in as ${answer.body.display_name}.`;
    const path = answer.body.return_to;
    wayBack(path === '/' ? 'Walk on Bramble' : 'Open the console', path);
  } catch (fault) {
    const sentences: Record<string, string> = {
      link_expired: copy.redeem.link_expired,
      link_used: copy.redeem.link_used,
      link_invalid: copy.redeem.link_invalid,
    };
    const message =
      fault instanceof ApiFault ? sentences[fault.code] ?? copy.internal : copy.internal;
    notices.say(message);
    outcome.textContent = message;
    wayBack('Walk on Bramble', '/');
  }
}

void redeem();
