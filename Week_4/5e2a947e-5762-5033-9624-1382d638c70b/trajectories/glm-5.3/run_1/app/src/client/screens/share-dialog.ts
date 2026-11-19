import { el, openDialog } from '../lib/dom.js';
import { api, errorOf } from '../lib/api.js';
import type { EditorStore } from '../lib/store.js';

/**
 * dialog "Share": the roles accordion with preview, invites, members
 * and expiring share links.
 */

export function openShareDialog(store: EditorStore, mapId: string, opener: HTMLElement): void {
  openDialog({
    label: 'Share',
    opener,
    async build(body) {
      body.appendChild(el('h2', {}, 'Share'));
      // Roles accordion with preview
      const roles: { name: string; can: string[] }[] = [
        { name: 'Owner', can: ['Manage roles, links and restrictions', 'Restore versions', 'Unlock any branch'] },
        { name: 'Editor', can: ['Edit topics and structure', 'Lock branches', 'Import and attach files'] },
        { name: 'Commenter', can: ['Comment and reply', 'Vote on topics', 'No structural edits'] },
        { name: 'Viewer', can: ['See the map and outline', 'Export', 'No comments or edits'] },
      ];
      for (const r of roles) {
        const row = el('button', { class: 'accordion-row', 'aria-expanded': 'false' }, r.name);
        const list = el('ul', { class: 'checklist', hidden: '' });
        for (const item of r.can) list.appendChild(el('li', {}, item));
        row.addEventListener('click', () => {
          const open = list.hidden;
          list.hidden = !open;
          row.setAttribute('aria-expanded', String(open));
        });
        body.append(row, list);
      }
      // Invite
      const inviteLabel = el('label', {}, 'Invite username');
      const inviteField = el('input', { 'aria-label': 'Invite username' }) as HTMLInputElement;
      const roleSelect = el('select', { 'aria-label': 'Role' }) as HTMLSelectElement;
      for (const r of ['editor', 'commenter', 'viewer']) roleSelect.append(el('option', { value: r }, r));
      const inviteBtn = el('button', { class: 'primary', 'aria-label': 'Invite' }, 'Invite');
      inviteBtn.addEventListener('click', async () => {
        const res = await api(`/api/maps/${mapId}/members/${encodeURIComponent(inviteField.value)}`, 'PUT', { role: roleSelect.value });
        if (res.ok) store.announce('Invited.');
        else store.announce(errorOf(res).message);
      });
      body.append(inviteLabel, inviteField, roleSelect, inviteBtn);
      // Members
      const membersList = el('ul', { role: 'list', 'aria-label': 'People with access' });
      const res = await api<{ members: { username: string; role: string }[] }>(`/api/maps/${mapId}/members`);
      const members = res.ok ? (res.body as { members: { username: string; role: string }[] }).members : [];
      for (const m of members) {
        const li = el('li', {});
        li.appendChild(el('span', {}, `${m.username} — ${m.role}`));
        if (m.role !== 'owner') {
          const roleFor = el('select', { 'aria-label': `Role for ${m.username}` }) as HTMLSelectElement;
          for (const r of ['editor', 'commenter', 'viewer']) roleFor.append(el('option', { value: r, ...(m.role === r ? { selected: '' } : {}) }, r));
          roleFor.addEventListener('change', async () => {
            await api(`/api/maps/${mapId}/members/${encodeURIComponent(m.username)}`, 'PUT', { role: roleFor.value });
          });
          const remove = el('button', { class: 'textlink', 'aria-label': `Remove ${m.username}` }, 'Remove');
          remove.addEventListener('click', async () => {
            await api(`/api/maps/${mapId}/members/${encodeURIComponent(m.username)}`, 'DELETE');
          });
          li.append(roleFor, remove);
        }
        membersList.appendChild(li);
      }
      body.appendChild(membersList);
      // Links
      const linkRole = el('select', { 'aria-label': 'Link role' }) as HTMLSelectElement;
      for (const r of ['editor', 'commenter', 'viewer']) linkRole.append(el('option', { value: r }, r));
      const expires = el('input', { type: 'datetime-local', 'aria-label': 'Expires' }) as HTMLInputElement;
      const createLink = el('button', { class: 'primary', 'aria-label': 'Create link' }, 'Create link');
      const linksList = el('ul', { role: 'list', 'aria-label': 'Share links' });
      const drawLinks = async () => {
        const res2 = await api<{ links: { id: string; code: string; role: string; expires_at: string | null; state: string; url: string }[] }>(`/api/maps/${mapId}/links`);
        const links = res2.ok ? (res2.body as { links: { id: string; code: string; role: string; expires_at: string | null; state: string; url: string }[] }).links : [];
        linksList.replaceChildren();
        for (const l of links) {
          const li = el('li', {}, `${l.url} (${l.role}, ${l.state})`);
          const copy = el('button', { class: 'textlink', 'aria-label': 'Copy link' }, 'Copy link');
          copy.addEventListener('click', () => { void navigator.clipboard?.writeText(`${location.origin}${l.url}`); });
          if (l.state === 'active') {
            const regen = el('button', { class: 'textlink', 'aria-label': 'Regenerate' }, 'Regenerate');
            regen.addEventListener('click', async () => { await api(`/api/maps/${mapId}/links/${l.id}/regenerate`, 'POST'); drawLinks(); });
            const off = el('button', { class: 'textlink', 'aria-label': 'Turn off' }, 'Turn off');
            off.addEventListener('click', async () => { await api(`/api/maps/${mapId}/links/${l.id}`, 'DELETE'); drawLinks(); });
            li.append(copy, regen, off);
          } else {
            li.appendChild(copy);
          }
          linksList.appendChild(li);
        }
      };
      createLink.addEventListener('click', async () => {
        const expiresAt = expires.value ? new Date(expires.value).toISOString() : null;
        const res2 = await api(`/api/maps/${mapId}/links`, 'POST', { role: linkRole.value, expires_at: expiresAt });
        if (res2.ok) drawLinks();
        else store.announce(errorOf(res2).message);
      });
      body.append(linkRole, expires, createLink, linksList);
      void drawLinks();
    },
  });
}
