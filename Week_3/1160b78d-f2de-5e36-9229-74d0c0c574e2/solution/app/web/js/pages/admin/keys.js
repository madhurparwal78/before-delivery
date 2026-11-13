// API keys: create, rotate and revoke. A new key is shown once, in a plain bar.
import { html, useState, useEffect, useCallback } from '../../lib/html.js';
import { api, fieldErrors } from '../../lib/api.js';
import { boot } from '../../lib/boot.js';
import { live } from '../../lib/live.js';
import { fmtLocal } from '../../lib/format.js';
import { Button, Bar, Problems, FieldError } from '../../lib/ui.js';

function graceText(key, zone) {
  if (key.revoked_at) return 'Revoked';
  return key.grace_ends_at ? `Old key works until ${fmtLocal(key.grace_ends_at, zone)}` : 'None';
}

export function ApiKeys({ onLoaded } = {}) {
  const zone = boot.user.timezone;
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState('read');
  const [errors, setErrors] = useState(null);
  const [shown, setShown] = useState(null);

  const load = useCallback(async () => {
    const res = await api.get('/api/api-keys');
    if (res.ok) setKeys(res.data.items);
    onLoaded?.();
  }, []);

  useEffect(() => {
    load();
    return live.on('access', load);
  }, []);

  const create = async () => {
    const res = await api.post('/api/api-keys', { name: name.trim(), scope });
    if (!res.ok) {
      setErrors(fieldErrors(res) ?? { name: 'The key could not be created.' });
      return;
    }
    setErrors(null);
    setName('');
    setShown({ name: res.data.name, key: res.data.key });
    await load();
  };

  const rotate = async (key) => {
    const res = await api.post(`/api/api-keys/${key.id}/rotate`, {});
    if (res.ok) setShown({ name: key.name, key: res.data.key });
    await load();
  };

  const revoke = async (key) => {
    await api.del(`/api/api-keys/${key.id}`);
    await load();
  };

  return html`<section class="block" aria-labelledby="keys-title">
    <h2 id="keys-title">API keys</h2>
    ${shown ? html`<${Bar}>
      <span>Key for ${shown.name}: <code class="secret">${shown.key}</code>. It is shown once and cannot be read again.</span>
      <button type="button" class="hide" onClick=${() => setShown(null)}>Hide key</button>
    </${Bar}>` : null}
    ${keys ? html`<div class="table-scroll" tabindex="0" role="region" aria-label="API keys table">
      <table aria-label="API keys">
        <thead><tr><th scope="col">Name</th><th scope="col">Scope</th><th scope="col">Prefix</th><th scope="col">Grace</th><th scope="col">Actions</th></tr></thead>
        <tbody>${keys.map((key) => html`<tr key=${key.id}>
          <th scope="row">${key.name}</th>
          <td data-label="Scope">${key.scope === 'write' ? 'Write' : 'Read'}</td>
          <td class="mono" data-label="Prefix">${key.prefix}</td>
          <td data-label="Grace">${graceText(key, zone)}</td>
          <td data-label="Actions">${key.revoked_at ? null : html`<div class="toolbar">
            <${Button} class="secondary" onClick=${() => rotate(key)}>${`Rotate ${key.name}`}</${Button}>
            <${Button} class="secondary" onClick=${() => revoke(key)}>${`Revoke ${key.name}`}</${Button}>
          </div>`}</td>
        </tr>`)}</tbody>
      </table>
    </div>` : null}
    <form class="keyform" onSubmit=${(event) => event.preventDefault()} noValidate>
      <${Problems} errors=${errors} />
      <div class="fields">
        <div class="field">
          <label for="name">Key name</label>
          <input id="name" type="text" value=${name} onInput=${(event) => setName(event.target.value)} autocomplete="off" />
          <${FieldError} errors=${errors} name="name" />
        </div>
        <div class="field">
          <label for="scope">Key scope</label>
          <select id="scope" onChange=${(event) => setScope(event.target.value)}>
            <option value="read" selected=${scope === 'read'}>Read</option>
            <option value="write" selected=${scope === 'write'}>Write</option>
          </select>
          <${FieldError} errors=${errors} name="scope" />
        </div>
        <div class="field act"><${Button} type="submit" onClick=${create}>Create key</${Button}></div>
      </div>
    </form>
  </section>`;
}
