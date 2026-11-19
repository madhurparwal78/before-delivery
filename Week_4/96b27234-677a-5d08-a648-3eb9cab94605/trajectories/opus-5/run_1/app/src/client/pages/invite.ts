import { api } from '../api.js';
import { el } from '../dom.js';
import { HEADING, heading, navigate } from '../shell.js';
import { button, statusRegion } from '../widgets.js';
import type { PageContext } from '../main.js';

export async function renderInvite(ctx: PageContext): Promise<void> {
  const token = ctx.params['token'] ?? '';
  const response = await api.get<{ from: string }>(`/api/invites/${encodeURIComponent(token)}`);
  if (!response.ok) {
    heading(ctx.main, HEADING.deadInvite);
    return;
  }
  heading(ctx.main, 'A friend invite');
  const accept = button('Accept invite', 'primary');
  const result = statusRegion('Invite result');
  ctx.main.append(
    el('section', { class: 'panel' }, [
      el('p', { text: `${response.data?.from ?? ''} invited you to Hearthtile.` }),
      accept,
      result
    ])
  );
  accept.addEventListener('click', () => {
    if (ctx.me === null) {
      navigate(`/signin?next=${encodeURIComponent(`/invites/${token}`)}`);
      return;
    }
    result.textContent = 'Saving...';
    void api.post(`/api/invites/${encodeURIComponent(token)}/accept`).then((accepted) => {
      if (accepted.ok) {
        navigate('/friends');
        return;
      }
      result.textContent = accepted.error ?? '';
    });
  });
}
