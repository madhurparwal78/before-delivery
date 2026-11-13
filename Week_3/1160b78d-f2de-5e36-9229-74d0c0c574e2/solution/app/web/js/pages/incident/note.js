// The note field: an unfinished note saves itself to the server about a second after typing stops and when the page is
// left, comes back on reload, in a second tab and on another device, and goes away everywhere with Add note.
import { html, useState, useEffect, useRef } from '../../lib/html.js';
import { boot } from '../../lib/boot.js';
import { api, fieldErrors, newKey } from '../../lib/api.js';
import { live } from '../../lib/live.js';
import { Button, Problems, FieldError } from '../../lib/ui.js';
import { decisionSentence } from './store.js';

const PAUSE_MS = 1000;

export function NoteBox({ incident, refresh }) {
  const id = incident.id;
  const draftPath = `/api/incidents/${id}/note-draft`;
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState(null);
  const field = useRef(null);
  const text = useRef('');
  const stored = useRef('');
  const touched = useRef(false);
  const timer = useRef(null);
  const chain = useRef(Promise.resolve());
  const attempt = useRef(null);

  const show = (body) => {
    text.current = body;
    setValue(body);
  };

  const save = () => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const body = text.current;
      if (body === stored.current) return;
      const res = await api.put(draftPath, { body });
      if (res.ok) stored.current = body;
    });
    return chain.current;
  };

  const readDraft = async () => {
    const res = await api.get(draftPath);
    if (!res.ok) return;
    if (document.activeElement === field.current || text.current !== stored.current) return;
    stored.current = res.data.body;
    if (res.data.body !== text.current) show(res.data.body);
  };

  useEffect(() => {
    api.get(draftPath).then((res) => {
      if (!res.ok || touched.current) return;
      stored.current = res.data.body;
      show(res.data.body);
    });
    const off = live.on('incident', (data) => {
      if (data.incident_id === id && data.draft_for === boot.user.id) readDraft();
    });
    // Leaving the page: send what has not been saved yet in a request that outlives it.
    const leave = () => {
      if (text.current === stored.current) return;
      fetch(draftPath, {
        method: 'PUT', keepalive: true, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text.current }),
      });
      stored.current = text.current;
    };
    const hidden = () => { if (document.visibilityState === 'hidden') leave(); };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      off();
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', hidden);
      clearTimeout(timer.current);
      leave();
    };
  }, [id]);

  const type = (event) => {
    touched.current = true;
    text.current = event.target.value;
    setValue(text.current);
    setErrors(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(save, PAUSE_MS);
  };

  const add = async () => {
    clearTimeout(timer.current);
    await chain.current;
    const body = text.current;
    if (!attempt.current || attempt.current.body !== body) attempt.current = { body, key: newKey() };
    const res = await api.post(`/api/incidents/${id}/notes`, { body }, { idempotencyKey: attempt.current.key });
    if (res.ok) {
      attempt.current = null;
      stored.current = '';
      show('');
      live.announce('Note added.');
      refresh();
    } else if (fieldErrors(res)) {
      setErrors(fieldErrors(res));
    } else {
      live.announce(decisionSentence(res) ?? 'That did not work. Try again.');
    }
  };

  return html`<section class="block" aria-labelledby="note-heading">
    <h2 id="note-heading">Add a note</h2>
    <${Problems} errors=${errors} />
    <div class="field">
      <label for="note">Note</label>
      <textarea id="note" name="body" ref=${field} value=${value} onInput=${type} aria-describedby=${errors?.body ? 'body-error' : undefined}></textarea>
      <${FieldError} errors=${errors} name="body" />
    </div>
    <${Button} onClick=${add}>Add note</${Button}>
  </section>`;
}
