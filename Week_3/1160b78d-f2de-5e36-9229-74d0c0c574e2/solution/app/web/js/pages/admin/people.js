// People: roles, forced sign-out and removal, with the list of what a refused removal would break.
import { html, useState, useEffect, useCallback } from '../../lib/html.js';
import { api } from '../../lib/api.js';
import { boot } from '../../lib/boot.js';
import { live } from '../../lib/live.js';
import { fmtLocal } from '../../lib/format.js';
import { Button } from '../../lib/ui.js';

const ROLES = [['responder', 'Responder'], ['lead', 'Lead'], ['admin', 'Admin'], ['stakeholder', 'Stakeholder']];
const LAST_ADMIN = 'There must always be one admin.';

function breakLine(item, zone) {
  return item.schedule
    ? `${item.schedule}: ${fmtLocal(item.start, zone)} to ${fmtLocal(item.end, zone)}`
    : `${item.policy}: level ${item.level}`;
}

export function People({ onLoaded } = {}) {
  const zone = boot.user.timezone;
  const [people, setPeople] = useState(null);
  const [refusal, setRefusal] = useState(null);

  const load = useCallback(async () => {
    const res = await api.get('/api/users');
    if (res.ok) setPeople(res.data.items);
    onLoaded?.();
  }, []);

  useEffect(() => {
    load();
    return live.on('access', load);
  }, []);

  const changeRole = async (person, role) => {
    setPeople(people.map((item) => (item.id === person.id ? { ...item, role } : item)));
    const res = await api.patch(`/api/users/${person.id}`, { role });
    if (res.status === 409) live.announce(LAST_ADMIN);
    await load();
  };

  const signOut = async (person) => {
    const res = await api.post(`/api/users/${person.id}/sign-out`);
    if (res.ok) live.announce(`${person.name} is signed out.`);
  };

  const remove = async (person) => {
    const res = await api.del(`/api/users/${person.id}`);
    if (res.ok) {
      setRefusal(null);
      live.announce(`${person.name} is removed.`);
      await load();
      return;
    }
    if (res.status === 409 && res.data.error === 'still_needed') {
      setRefusal({ name: person.name, breaks: res.data.breaks });
      live.announce(`${person.name} cannot be removed yet.`);
    } else if (res.status === 409) {
      live.announce(LAST_ADMIN);
    }
    setTimeout(() => document.getElementById(`remove-${person.id}`)?.focus(), 0);
  };

  return html`<section class="block" aria-labelledby="people-title">
    <h2 id="people-title">People</h2>
    ${people ? html`<div class="table-scroll" tabindex="0" role="region" aria-label="People table">
      <table aria-label="People">
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Sign-out</th><th scope="col">Removal</th></tr></thead>
        <tbody>${people.map((person) => html`<tr key=${person.id}>
          <th scope="row">${person.name}</th>
          <td data-label="Email">${person.email}</td>
          <td data-label="Role"><select aria-label=${`Role for ${person.name}`} value=${person.role} onChange=${(event) => changeRole(person, event.target.value)}>
            ${ROLES.map(([value, label]) => html`<option value=${value} selected=${person.role === value}>${label}</option>`)}
          </select></td>
          <td data-label="Sign-out"><${Button} class="secondary" onClick=${() => signOut(person)}>${`Sign ${person.name} out`}</${Button}></td>
          <td data-label="Removal"><${Button} class="secondary" id=${`remove-${person.id}`}
            onClick=${() => remove(person)}>${`Remove ${person.name}`}</${Button}></td>
        </tr>`)}</tbody>
      </table>
    </div>` : null}
    ${refusal ? html`<div class="refusal">
      <h3>${refusal.name} cannot be removed yet</h3>
      <p>Removing this person would break the following.</p>
      <ul aria-label="What this removal breaks">${refusal.breaks.map((item, index) => html`<li key=${index}>${breakLine(item, zone)}</li>`)}</ul>
    </div>` : null}
  </section>`;
}
