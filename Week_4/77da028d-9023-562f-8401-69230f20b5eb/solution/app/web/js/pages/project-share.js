// The Share project dialog: one live link per project, created, regenerated or revoked here.
import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { announce } from '../core/live.js';
import { createDialog } from '../core/dialog.js';
import { createErrorSummary, clearInvalid, field } from '../core/forms.js';
import { isoToWall, wallToIso } from '../core/time.js';
import { lendRegion } from './values.js';

const EXPIRY_FORMAT = 'Enter the expiry as YYYY-MM-DD HH:MM in site time.';

function utcStamp(iso) {
  return new Date(iso).toISOString().replace('.000Z', 'Z');
}

export async function openShareDialog({ projectId, opener, updates, updatesHome }) {
  const lend = lendRegion(updates, updatesHome);
  const dialog = createDialog({ name: 'Share project', onClose: () => lend.back() });
  const summary = createErrorSummary();
  const link = h('input', { type: 'text', readonly: true, 'data-field': 'share_link' });
  const expires = h('input', { type: 'text', placeholder: 'YYYY-MM-DD HH:MM', 'data-field': 'expires_at', autocomplete: 'off' });
  const create = h('button', { type: 'button', class: 'btn btn--primary', disabled: true, onclick: () => issue('Share link ready.') }, 'Create link');
  const copy = h('button', { type: 'button', class: 'btn', disabled: true, onclick: copyLink }, 'Copy link');
  const regenerate = h('button', { type: 'button', class: 'btn', disabled: true, onclick: () => issue('New share link ready. The old link no longer works.') }, 'Regenerate link');
  const revoke = h('button', { type: 'button', class: 'btn', disabled: true, onclick: revokeLink }, 'Revoke link');
  const done = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Done');
  dialog.body.append(summary.element,
    field({ label: 'Share link', input: link, hint: 'Anyone with this link can read the integration summary, never your notes or exact position.' }),
    field({ label: 'Link expires', input: expires, hint: 'Optional. Site time, YYYY-MM-DD HH:MM.' }));
  dialog.actions.append(done, copy, revoke, regenerate, create);
  lend.into(dialog);
  dialog.open(opener);

  const site = await api('GET', '/api/site');
  let share = null;

  function paint() {
    link.value = share ? `${location.origin}${share.url}` : '';
    expires.value = share && share.expires_at ? isoToWall(share.expires_at, site.time_zone) : '';
    create.disabled = share !== null;
    for (const button of [copy, revoke, regenerate]) button.disabled = share === null;
  }

  try {
    share = await api('GET', `/api/projects/${projectId}/share`);
  } catch (error) {
    if (error.status !== 404) announce(updates, error.message);
  }
  paint();

  async function issue(message) {
    summary.clear();
    clearInvalid(dialog.body);
    const text = expires.value.trim();
    const stamp = text === '' ? null : wallToIso(text, site.time_zone);
    if (text !== '' && stamp === null) {
      summary.showFields({ expires_at: EXPIRY_FORMAT }, () => expires);
      return;
    }
    try {
      share = await api('POST', `/api/projects/${projectId}/share`, { body: { expires_at: stamp === null ? null : utcStamp(stamp) } });
      paint();
      announce(updates, message);
    } catch (error) {
      if (error.fields) summary.showFields(error.fields, (name) => dialog.body.querySelector(`[data-field="${name}"]`));
      else summary.showMessage(error.message);
    }
  }

  async function revokeLink() {
    try {
      await api('DELETE', `/api/projects/${projectId}/share`);
      share = null;
      paint();
      announce(updates, 'Share link revoked.');
    } catch (error) {
      summary.showMessage(error.message);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.value);
      announce(updates, 'Share link copied.');
    } catch {
      link.select();
      announce(updates, 'Link selected. Copy it with your keyboard.');
    }
  }
}
