// Team screen: moderator rules.
import { el } from './publicPage';
import { api, setChangeToken } from './api';
import { announce, registerLiveRegion } from './announce';
import { ruleText } from './rules';
import type { SessionBody, TeamBody } from './types';

const TOPIC_OPTIONS: [string, string][] = [
  ['bug', 'bug'],
  ['account', 'account'],
  ['purchase', 'purchase'],
  ['other', 'other'],
  ['*', 'all topics'],
];

export async function teamPage(root: HTMLElement): Promise<void> {
  document.title = 'Team — Hushline';
  const sessionResult = await api<SessionBody>('GET', '/api/auth/session');
  if (!sessionResult.ok) {
    window.location.href = '/signin';
    return;
  }
  const session = sessionResult.body!;
  if (session.user.role !== 'developer') {
    window.location.href = '/inbox';
    return;
  }
  setChangeToken(session.change_token);

  const container = el('div', { class: 'column' });
  container.append(el('h1', {}, 'Team'));
  const announcements = el('div', { role: 'status', 'aria-live': 'polite', class: 'visually-hidden' });
  registerLiveRegion('team', announcements);
  container.append(announcements);

  const list = el('div', { class: 'panel' });
  container.append(list);
  root.append(container);
  await renderTeam(list);
}

async function renderTeam(list: HTMLElement): Promise<void> {
  const result = await api<TeamBody>('GET', '/api/team');
  if (!result.ok) return;
  list.textContent = '';
  for (const moderator of result.body!.moderators) {
    const region = el('section', { 'aria-label': moderator.name });
    region.append(el('h2', {}, moderator.name), el('p', { class: 'muted' }, moderator.email));
    const rulesList = el('ul', { 'aria-label': 'Rules', class: 'rule-list' });
    for (const rule of moderator.rules) {
      const text = ruleText(rule);
      const revoke = el('button', { type: 'button', 'aria-label': `Revoke ${text}` }, 'Revoke');
      revoke.addEventListener('click', () => void revokeRule(list, moderator.id, rule.id));
      rulesList.append(el('li', {}, el('span', {}, text), revoke));
    }
    region.append(rulesList);
    const form = el('form', { novalidate: 'novalidate' }) as HTMLFormElement;
    const effect = el('select', { 'aria-label': 'Effect' }) as HTMLSelectElement;
    effect.append(el('option', { value: 'grant' }, 'grant'), el('option', { value: 'deny' }, 'deny'));
    const action = el('select', { 'aria-label': 'Action' }) as HTMLSelectElement;
    for (const [value, label] of [['read', 'read'], ['reply', 'reply'], ['close', 'close'], ['receipts', 'receipts']] as [string, string][]) {
      action.append(el('option', { value }, label));
    }
    const topic = el('select', { 'aria-label': 'Topic' }) as HTMLSelectElement;
    for (const [value, label] of TOPIC_OPTIONS) {
      topic.append(el('option', { value }, label));
    }
    const add = el('button', { type: 'submit', class: 'accent' }, 'Add rule');
    form.append(effect, action, topic, add);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void addRule(list, moderator.id, { effect: effect.value, action: action.value, topic: topic.value });
    });
    region.append(form);
    list.append(region);
  }
}

async function addRule(list: HTMLElement, moderatorId: string, body: { effect: string; action: string; topic: string }): Promise<void> {
  announce('team', 'Adding rule...');
  const result = await api('POST', `/api/team/${moderatorId}/rules`, body);
  if (result.ok) {
    announce('team', 'Rule added.');
    await renderTeam(list);
  } else {
    announce('team', 'Rule not saved. Try again.');
  }
}

async function revokeRule(list: HTMLElement, moderatorId: string, ruleId: string): Promise<void> {
  announce('team', 'Revoking rule...');
  const result = await api('DELETE', `/api/team/${moderatorId}/rules/${ruleId}`);
  if (result.ok) {
    announce('team', 'Rule revoked.');
    await renderTeam(list);
  } else {
    announce('team', 'Rule not revoked. Try again.');
  }
}
