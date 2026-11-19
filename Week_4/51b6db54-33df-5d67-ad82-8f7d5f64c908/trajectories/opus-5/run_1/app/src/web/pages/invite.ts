import { api, refusalText, type ApiFailure } from '../api.js';
import { button, el } from '../dom.js';
import { mountRegions } from '../regions.js';
import { go } from '../router.js';
import { date, person } from '../session.js';

interface InviteView {
  project: string;
  role: string;
  state: string;
  expires_at: string;
}

export async function invitePage(params: string[]): Promise<HTMLElement> {
  const token = params[0];
  const regions = mountRegions();
  const result = await api.get<InviteView>(`/api/invites/${token}`);
  if (!result.ok) {
    return el('main', { class: 'column' }, [
      regions.root,
      el('div', { class: 'card' }, [el('h1', { text: 'That invite is not here' })]),
    ]);
  }
  const invite = result.body;
  const card = el('div', { class: 'card' }, [
    el('h1', { text: `Join ${invite.project}` }),
    el('p', { text: `Role: ${invite.role === 'editor' ? 'Editor' : 'Reviewer'}` }),
    el('p', { text: `Expires: ${date(invite.expires_at)}` }),
    el('p', { text: `State: ${invite.state}` }),
  ]);

  if (person() === null) {
    card.append(
      el('p', { class: 'hint' }, [
        el('a', { href: `/signin?next=/invites/${token}` }, ['Sign in to accept']),
        el('span', { text: ' · ' }),
        el('a', { href: `/signup?next=/invites/${token}` }, ['Make an account']),
      ]),
    );
    return el('main', { class: 'column' }, [regions.root, card]);
  }

  card.append(
    button('Accept invite', async () => {
      const accepted = await api.post<ApiFailure & { project: number; project_name: string }>(
        `/api/invites/${token}/accept`,
      );
      if (!accepted.ok) {
        regions.alert(refusalText(accepted));
        return;
      }
      regions.notice(`You joined ${accepted.body.project_name}`);
      go(`/projects/${accepted.body.project}`);
    }),
  );

  return el('main', { class: 'column' }, [regions.root, card]);
}
