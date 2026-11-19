import { DEGREE_LABELS, formatDate, formatTime } from '../../shared/format';
import { api } from '../api';
import { announce, h, showAlert } from '../dom';
import { cfg, refreshCounters } from '../state';
import { S } from '../strings';

export type PersonCard = {
  id: string;
  handle: string;
  name: string;
  headline: string;
  photo_url?: string | null;
  degree: string;
  connection_state: string;
  mutual_count: number;
  requested_at?: string;
  connected_at?: string;
};

export function degreeLabelNode(degree: string): HTMLElement {
  return h('span', {
    'data-degree-badge': '',
    'data-degree': degree,
    class: 'degree-label tabular',
    text: DEGREE_LABELS[degree] ?? '',
  });
}

type Outcome = { state?: string; failed?: boolean };

export async function connectTo(
  member: { id: string; name: string },
  host: HTMLElement,
  onProfile: boolean,
): Promise<Outcome> {
  const result = await api.post<{ state: string; retry_at?: string; limit?: number; error?: string }>(
    '/api/connections',
    { member_id: member.id },
  );
  if (result.ok) {
    if (result.body.state === 'connected') {
      announce(
        'Network announcements',
        onProfile
          ? S.announce.connectedOnProfile(member.name)
          : S.announce.connectedElsewhere(member.name),
      );
    } else {
      announce('Network announcements', S.announce.invitationSent(member.name));
    }
    void refreshCounters();
    return { state: result.body.state };
  }
  if (result.status === 409 && result.body.error === 'invite_cooldown' && result.body.retry_at) {
    const retry = new Date(result.body.retry_at);
    showAlert(
      host,
      S.alert.cooldown(
        member.name,
        formatDate(retry, cfg().time_zone),
        formatTime(retry, cfg().time_zone),
      ),
    );
  } else if (result.status === 429) {
    showAlert(host, S.alert.weeklyLimit(result.body.limit ?? 0));
  } else {
    showAlert(host, S.alert.somethingWrong);
  }
  announce('Network announcements', S.announce.invitationFailed);
  return { failed: true };
}

export async function withdrawTo(memberId: string, host: HTMLElement): Promise<Outcome> {
  const result = await api.post(`/api/connections/${memberId}/withdraw`);
  if (result.ok) {
    announce('Network announcements', S.announce.invitationWithdrawn);
    return { state: 'withdrawn' };
  }
  showAlert(host, S.alert.somethingWrong);
  return { failed: true };
}

export async function acceptFrom(
  member: { id: string; name: string },
  host: HTMLElement,
  onProfile: boolean,
): Promise<Outcome> {
  const result = await api.post(`/api/connections/${member.id}/accept`);
  if (result.ok) {
    announce(
      'Network announcements',
      onProfile
        ? S.announce.connectedOnProfile(member.name)
        : S.announce.connectedElsewhere(member.name),
    );
    void refreshCounters();
    return { state: 'connected' };
  }
  showAlert(host, S.alert.somethingWrong);
  return { failed: true };
}

export async function ignoreFrom(memberId: string, host: HTMLElement): Promise<Outcome> {
  const result = await api.post(`/api/connections/${memberId}/ignore`);
  if (result.ok) {
    announce('Network announcements', S.announce.invitationIgnored);
    void refreshCounters();
    return { state: 'ignored' };
  }
  showAlert(host, S.alert.somethingWrong);
  return { failed: true };
}

export async function removeConnectionWith(memberId: string, host: HTMLElement): Promise<Outcome> {
  const result = await api.del(`/api/connections/${memberId}`);
  if (result.ok) {
    announce('Network announcements', S.announce.connectionRemoved);
    return { state: 'none' };
  }
  showAlert(host, S.alert.somethingWrong);
  return { failed: true };
}

function cardButtons(card: PersonCard, host: HTMLElement, reload: () => void): HTMLElement[] {
  const after = (outcome: Outcome): void => {
    if (!outcome.failed) reload();
  };
  const buttons: HTMLElement[] = [];
  const state = card.connection_state;
  if (state === 'none' || state === 'withdrawn' || state === 'ignored') {
    buttons.push(
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          click: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            after(await connectTo(card, host, false));
            button.disabled = false;
          },
        },
        [`Connect with ${card.name}`],
      ),
    );
  } else if (state === 'pending_sent') {
    buttons.push(
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          click: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            after(await withdrawTo(card.id, host));
            button.disabled = false;
          },
        },
        [`Withdraw request to ${card.name}`],
      ),
    );
  } else if (state === 'pending_received') {
    buttons.push(
      h(
        'button',
        {
          type: 'button',
          class: 'button',
          click: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            after(await acceptFrom(card, host, false));
          },
        },
        [`Accept ${card.name}`],
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'button quiet',
          click: async (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            button.disabled = true;
            after(await ignoreFrom(card.id, host));
          },
        },
        [`Ignore ${card.name}`],
      ),
    );
  } else if (state === 'connected') {
    buttons.push(
      h('a', { href: `/messaging/with/${card.handle}`, class: 'button' }, [`Message ${card.name}`]),
    );
  }
  return buttons;
}

export function personCardNode(
  card: PersonCard,
  options: { reload?: () => void; extra?: Node | null } = {},
): HTMLElement {
  const item = h('li', {
    class: 'person-card',
    'data-member-id': card.id,
    'data-degree': card.degree,
    'data-connection-state': card.connection_state,
  });
  const host = h('div', { class: 'card-actions' });
  item.append(
    h('div', { class: 'card-main' }, [
      h('a', { href: `/in/${card.handle}`, class: 'person-name' }, [card.name]),
      h('p', { class: 'headline', text: card.headline }),
      degreeLabelNode(card.degree),
    ]),
  );
  if (options.extra) item.append(options.extra);
  for (const button of cardButtons(card, host, options.reload ?? (() => undefined))) {
    host.append(button);
  }
  item.append(host);
  return item;
}
