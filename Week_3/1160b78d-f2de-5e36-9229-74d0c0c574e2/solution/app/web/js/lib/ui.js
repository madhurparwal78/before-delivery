// Shared building blocks. Every component is plain Preact (html`...`).
//
//   <${Button} onClick=${async () => {...}}>Save</${Button}>    busy while the promise runs: disabled + aria-busy, one request per click burst
//   <${Dialog} title="Snooze incident" opener=${ref} onClose=${fn}>...</${Dialog}>   <dialog aria-label=title>, trap/Escape/restore focus
//   <${Problems} errors=${{field: 'sentence'}} />               alert "Problems to fix": one link per error that focuses its field (id = field name)
//   <${Bar}>text</${Bar}>                                        plain full-width notice bar (outage and slower-state notices)
//   <${Empty}>Nothing is open.</${Empty}>                        one short sentence, wide margins
//   <${Tone} status="Triggered" />                               status word with its tone
import { html, useState, useRef, useEffect } from './html.js';
import { openDialog } from './dialog.js';
import { live } from './live.js';

export function Button({ onClick, busy: forced, children, class: cls, type = 'button', ...rest }) {
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const handle = async (event) => {
    if (guard.current || !onClick) return;
    guard.current = true;
    setBusy(true);
    const slow = setTimeout(() => live.announce('Working on it.'), 1000);
    try {
      await onClick(event);
    } finally {
      clearTimeout(slow);
      guard.current = false;
      setBusy(false);
    }
  };
  const isBusy = busy || forced;
  return html`<button type=${type} class=${cls} onClick=${handle} disabled=${isBusy || rest.disabled} aria-busy=${isBusy ? 'true' : undefined}
    ...${rest}>${children}</button>`;
}

export function Dialog({ title, onClose, opener, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const handle = openDialog(ref.current, opener?.current ?? opener ?? undefined, onClose);
    return () => handle.close();
  }, []);
  return html`<dialog ref=${ref} aria-label=${title} class="sheet">${children}</dialog>`;
}

export function Problems({ errors }) {
  const entries = errors ? Object.entries(errors) : [];
  if (!entries.length) return null;
  const jump = (field) => (event) => {
    event.preventDefault();
    const el = document.getElementById(field) ?? document.querySelector(`[name="${field}"]`);
    if (el) el.focus();
  };
  return html`<div role="alert" aria-label="Problems to fix" class="problems"><ul>${entries.map(
    ([field, sentence]) => html`<li key=${field}><a href=${'#' + field} onClick=${jump(field)}>${sentence}</a></li>`,
  )}</ul></div>`;
}

export function FieldError({ errors, name }) {
  return errors && errors[name] ? html`<p class="field-error" id=${name + '-error'}>${errors[name]}</p>` : null;
}

export function Bar({ children }) {
  return html`<div class="bar" role="note">${children}</div>`;
}

export function Empty({ children, ...rest }) {
  return html`<p class="empty" tabindex="-1" ...${rest}>${children}</p>`;
}

const TONES = {
  Triggered: 'bad', Acknowledged: 'ok', Snoozed: 'warn', Resolved: 'quiet',
  'Major outage': 'bad', 'Partial outage': 'bad', Degraded: 'warn', Maintenance: 'warn', Operational: 'ok',
  Pending: 'warn', Retrying: 'warn', Delivered: 'ok', Rejected: 'bad', Failed: 'bad',
  Scheduled: 'quiet', Queued: 'warn', Sent: 'ok', Cancelled: 'quiet', Upcoming: 'quiet', Running: 'warn', Ended: 'quiet',
};

export function Tone({ status, children }) {
  const word = children ?? status;
  return html`<span class=${'tone tone-' + (TONES[status] ?? 'quiet')}>${word}</span>`;
}
