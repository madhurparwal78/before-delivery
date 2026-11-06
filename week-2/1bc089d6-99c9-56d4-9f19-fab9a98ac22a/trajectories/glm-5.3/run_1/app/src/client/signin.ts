// The sign-in page: one link, checked once as the page loads.
import { qs, announce, postJson } from './dom.js';

export function bootSignin(): void {
  const status = qs<HTMLElement>('#link-status');
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    status.textContent = 'We do not recognise this link.';
    return;
  }
  status.textContent = 'Checking your link…';
  void (async () => {
    const res = await postJson<{ signed_in?: boolean; confirmed?: boolean; error?: { code: string } }>('/api/session/verify', { token }).catch(() => null);
    if (res === null || res.status === 503) {
      announce(status, 'Saving is unavailable right now. Your choices are still on this page; try again in a minute.');
      return;
    }
    if (res.status === 200 && res.body) {
      announce(status, res.body.confirmed ? 'Your Stillhour is confirmed. Reminders are on.' : 'You are signed in.');
      return;
    }
    const code = res.body?.error?.code;
    if (code === 'link_used') {
      announce(status, 'This link has already been used. Ask for a new one on Manage my hour.');
      return;
    }
    if (code === 'link_expired') {
      announce(status, 'This link has expired. Ask for a new one on Manage my hour.');
      return;
    }
    announce(status, 'We do not recognise this link.');
  })();
}
