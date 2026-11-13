// The dead letters table with its Replay dialog, used on /integrations (every integration) and /integrations/<id>.
import { html, useState, Fragment } from '../../lib/html.js';
import { api, fieldErrors } from '../../lib/api.js';
import { boot } from '../../lib/boot.js';
import { live } from '../../lib/live.js';
import { fmtLocal } from '../../lib/format.js';
import { Button, Dialog, Empty, Problems, FieldError } from '../../lib/ui.js';

const PREVIEW_LENGTH = 90;

function pretty(raw) {
  if (raw && typeof raw === 'object') return JSON.stringify(raw, null, 2);
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return String(raw ?? '');
  }
}

function preview(raw) {
  const flat = (typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
}

function ReplayDialog({ letter, opener, onClose, onReplayed }) {
  const [text, setText] = useState(() => pretty(letter.raw));
  const [errors, setErrors] = useState(null);

  const replay = async () => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      setErrors({ message: 'Body is not valid JSON.' });
      return;
    }
    const res = await api.post(`/api/dead-letters/${letter.id}/replay`, { message });
    if (res.ok) {
      live.announce('Replayed. The event applied once.');
      onReplayed();
      return;
    }
    if (res.status === 409) {
      onReplayed();
      return;
    }
    setErrors(fieldErrors(res) ?? { message: 'The message could not be replayed.' });
  };

  return html`<${Dialog} title="Replay dead letter" opener=${opener} onClose=${onClose}>
    <h2>Replay dead letter</h2>
    <p class="muted">${letter.reason}</p>
    <${Problems} errors=${errors} />
    <div class="field">
      <label for="message">Corrected message</label>
      <textarea id="message" name="message" class="mono" spellcheck="false" rows="12" value=${text}
        onInput=${(event) => setText(event.target.value)}></textarea>
      <${FieldError} errors=${errors} name="message" />
    </div>
    <div class="toolbar">
      <${Button} onClick=${replay}>Replay message</${Button}>
      <${Button} class="secondary" onClick=${onClose}>Cancel</${Button}>
    </div>
  </${Dialog}>`;
}

// DeadLetters: items from GET /api/dead-letters; `integrationOf(letter)` names the integration on the firm-wide list.
export function DeadLetters({ items, onChanged, integrationOf }) {
  const [open, setOpen] = useState(null);
  const canReplay = boot.user.role !== 'responder';
  const zone = boot.user.timezone;

  if (!items.length) return html`<${Empty}>No dead letters.</${Empty}>`;
  return html`<${Fragment}>
    <div class="table-scroll" tabindex="0" role="region" aria-label="Dead letters table">
    <table aria-label="Dead letters">
      <thead><tr>
        ${integrationOf ? html`<th scope="col">Integration</th>` : null}
        <th scope="col">Reason</th><th scope="col">Message</th><th scope="col">Attempts</th><th scope="col">Dead since</th>
        ${canReplay ? html`<th scope="col">Action</th>` : null}
      </tr></thead>
      <tbody>${items.map((letter) => html`<tr key=${letter.id}>
        ${integrationOf ? html`<td data-label="Integration">${integrationOf(letter)}</td>` : null}
        <td data-label="Reason">${letter.reason}</td>
        <td class="mono clip" data-label="Message">${preview(letter.raw)}</td>
        <td data-label="Attempts">${letter.attempts}</td>
        <td data-label="Dead since">${fmtLocal(letter.dead_at, zone)}</td>
        ${canReplay ? html`<td class="action" data-label="Action"><button type="button" onClick=${(event) => setOpen({ letter, opener: event.currentTarget })}>Replay</button></td>` : null}
      </tr>`)}</tbody>
    </table>
    </div>
    ${open ? html`<${ReplayDialog} letter=${open.letter} opener=${open.opener} onClose=${() => setOpen(null)}
      onReplayed=${() => { setOpen(null); onChanged(); }} />` : null}
  </${Fragment}>`;
}
