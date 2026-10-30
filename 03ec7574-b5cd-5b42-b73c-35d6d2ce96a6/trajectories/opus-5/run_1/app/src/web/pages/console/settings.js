import { MEMBER_ROLES } from '../../../api/governance.js';
import { h } from '../../html.js';
import { consolePage } from '../../layout.js';
import { displayTime } from './parts.js';

export const KEY_ONCE_NOTE = 'Copy this key now. It will not be shown again.';

export function renderSettings({ session, data, toasts, awaiting }) {
  const isOwner = session.member.role === 'owner';
  const readsKeys = ['owner', 'auditor'].includes(session.member.role);
  const content = `
    <h1>Settings</h1>
    <section class="panel">
      <h2>Organization</h2>
      <dl class="facts">
        <div><dt>Name</dt><dd>${h(session.organization.name)}</dd></div>
        <div><dt>App id</dt><dd><span class="mono" data-app-id>${h(session.organization.app_id)}</span>
          <button type="button" class="capsule capsule-light" data-copy-address data-value="${h(session.organization.app_id)}">Copy app id</button></dd></div>
      </dl>
    </section>

    <section class="panel">
      <div class="inline-actions" style="justify-content:space-between;align-items:center">
        <h2>Members</h2>
        ${isOwner ? '<button type="button" class="capsule capsule-dark" data-toggle="add-member">Add member</button>' : ''}
      </div>
      <table class="stacked">
        <caption>Members</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Added</th><th scope="col">Actions</th></tr></thead>
        <tbody>
          ${data.members.map((member) => `
            <tr>
              <td data-label="Name">${h(member.name)}</td>
              <td data-label="Email">${h(member.email)}</td>
              <td data-label="Role">
                ${isOwner ? `
                  <form method="post" action="/console/settings" data-role-form>
                    <input type="hidden" name="__action" value="update-member">
                    <input type="hidden" name="member_id" value="${h(member.id)}">
                    <label class="sr-only" for="role-${h(member.id)}">Role for ${h(member.name)}</label>
                    <select id="role-${h(member.id)}" name="role" data-role-select>
                      ${MEMBER_ROLES.map((role) => `<option value="${role}"${role === member.role ? ' selected' : ''}>${role}</option>`).join('')}
                    </select>
                    <button type="submit" class="capsule capsule-light">Save role</button>
                  </form>` : h(member.role)}
              </td>
              <td data-label="Added">${h(displayTime(member.created_at))}</td>
              <td data-label="Actions">
                ${isOwner ? `
                  <button type="button" class="capsule capsule-light" data-open-remove="${h(member.id)}">Remove ${h(member.name)}</button>
                  <dialog aria-label="Remove member" data-remove-dialog="${h(member.id)}">
                    <h2>Remove member</h2>
                    <p>${h(member.name)} loses every session and their API keys are revoked.</p>
                    <form method="post" action="/console/settings" class="dialog-actions" data-remove-form>
                      <input type="hidden" name="__action" value="remove-member">
                      <input type="hidden" name="member_id" value="${h(member.id)}">
                      <button type="button" class="capsule capsule-light" data-close-dialog>Keep member</button>
                      <button type="submit" class="capsule capsule-dark">Remove</button>
                    </form>
                  </dialog>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${isOwner ? `
        <div hidden data-panel="add-member">
          <form method="post" action="/console/settings" data-member-form>
            <input type="hidden" name="__action" value="add-member">
            <div class="field"><label for="member-name">Member name</label><input type="text" id="member-name" name="name"></div>
            <div class="field"><label for="member-email">Member email</label><input type="text" id="member-email" name="email"></div>
            <div class="field">
              <label for="member-role">Member role</label>
              <select id="member-role" name="role">${MEMBER_ROLES.map((role) => `<option value="${role}">${role}</option>`).join('')}</select>
            </div>
            <div class="field"><label for="member-password">Initial password</label><input type="password" id="member-password" name="password"></div>
            <button type="submit" class="capsule capsule-dark">Save member</button>
            <p class="field-error" data-form-error></p>
          </form>
        </div>` : ''}
    </section>

    ${readsKeys ? `
    <section class="panel">
      <div class="inline-actions" style="justify-content:space-between;align-items:center">
        <h2>API keys</h2>
        ${isOwner ? '<button type="button" class="capsule capsule-dark" data-toggle="create-key">Create API key</button>' : ''}
      </div>
      <table class="stacked">
        <caption>API keys</caption>
        <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Prefix</th><th scope="col">Creator</th><th scope="col">Created</th><th scope="col">Revoked</th><th scope="col">Actions</th></tr></thead>
        <tbody>
          ${data.apiKeys.map((key) => `
            <tr>
              <td data-label="Name">${h(key.name)}</td>
              <td data-label="Role">${h(key.role)}</td>
              <td data-label="Prefix"><span class="mono">${h(key.prefix)}</span></td>
              <td data-label="Creator">${h(data.names.get(key.created_by) || key.created_by)}</td>
              <td data-label="Created">${h(displayTime(key.created_at))}</td>
              <td data-label="Revoked">${h(key.revoked_at ? displayTime(key.revoked_at) : '')}</td>
              <td data-label="Actions">
                ${isOwner && !key.revoked_at ? `
                  <form method="post" action="/console/settings" data-key-revoke-form>
                    <input type="hidden" name="__action" value="revoke-api-key">
                    <input type="hidden" name="api_key_id" value="${h(key.id)}">
                    <button type="submit" class="capsule capsule-light">Revoke ${h(key.name)}</button>
                  </form>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${isOwner ? `
        <div hidden data-panel="create-key">
          <form method="post" action="/console/settings" data-key-form>
            <input type="hidden" name="__action" value="create-api-key">
            <div class="field"><label for="key-name">Key name</label><input type="text" id="key-name" name="name"></div>
            <div class="field">
              <label for="key-role">Key role</label>
              <select id="key-role" name="role"><option value="operator">operator</option><option value="auditor">auditor</option></select>
            </div>
            <button type="submit" class="capsule capsule-dark">Save API key</button>
            <p class="field-error" data-form-error></p>
          </form>
          <div data-new-key hidden>
            <p class="mono" data-new-key-secret></p>
            <p>${h(KEY_ONCE_NOTE)}</p>
          </div>
        </div>` : ''}
    </section>` : ''}

    ${isOwner ? `
      <section class="panel">
        <h2>Webhook signing secret</h2>
        <p class="mono" data-secret>${h(data.secret || '')}</p>
        <div class="inline-actions">
          <form method="post" action="/console/settings" data-secret-form>
            <input type="hidden" name="__action" value="reveal-secret">
            <button type="submit" class="capsule capsule-light">Reveal</button>
          </form>
          <form method="post" action="/console/settings" data-secret-form>
            <input type="hidden" name="__action" value="rotate-secret">
            <button type="submit" class="capsule capsule-light">Rotate</button>
          </form>
        </div>
      </section>` : ''}`;

  return consolePage({ title: 'Settings — Corvo console', session, active: '/console/settings', content, toasts, awaiting });
}
