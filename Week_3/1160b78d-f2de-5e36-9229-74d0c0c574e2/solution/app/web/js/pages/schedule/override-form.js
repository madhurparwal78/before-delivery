// dialog "Schedule an override": the keyboard-and-phone road to the same 15-minute result as Handoff Cut.
import { html, useState, useRef } from '../../lib/html.js';
import { api, newKey, fieldErrors } from '../../lib/api.js';
import { live } from '../../lib/live.js';
import { fmtLocal } from '../../lib/format.js';
import { Button, Dialog, Problems, FieldError } from '../../lib/ui.js';
import { serverNow } from './serverclock.js';
import { STEP, iso, floorStep, stepBy, typed, fromTyped } from './zonetime.js';
import { refusalText } from './cut.js';

const FORMAT_ERROR = 'Use the format YYYY-MM-DD HH:MM.';

export function OverrideForm({ scheduleId, scheduleZone, zone, people, defaultPerson, opener, onClose, reload }) {
  const first = floorStep(serverNow(), zone) + STEP;
  const [person, setPerson] = useState(defaultPerson);
  const [starts, setStarts] = useState(typed(first, zone));
  const [ends, setEnds] = useState(typed(first + 4 * STEP, zone));
  const [errors, setErrors] = useState(null);
  const pending = useRef(false);

  // Up and Down move a typed time by one 15-minute step.
  const stepper = (value, setValue) => (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const ms = fromTyped(value, zone);
    if (ms === null) return;
    event.preventDefault();
    setValue(typed(stepBy(ms, event.key === 'ArrowUp' ? 1 : -1, zone), zone));
  };

  const save = async () => {
    if (pending.current) return;
    const startMs = fromTyped(starts, zone);
    const endMs = fromTyped(ends, zone);
    const problems = {};
    if (startMs === null) problems.start = FORMAT_ERROR;
    if (endMs === null) problems.end = FORMAT_ERROR;
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    pending.current = true;
    const res = await api.post(`/api/schedules/${scheduleId}/overrides`,
      { person_id: person || null, start: iso(startMs), end: iso(endMs) }, { idempotencyKey: newKey() });
    pending.current = false;
    if (!res.ok) {
      const text = refusalText(res);
      if (!fieldErrors(res)) live.announce(text);
      setErrors(fieldErrors(res) ?? { start: text });
      return;
    }
    const saved = res.data.override ?? {};
    const name = people.find((p) => p.id === person)?.name ?? 'Nobody';
    const who = typeof saved.person === 'string' ? saved.person : saved.person?.name ?? name;
    live.announce(`Override saved: ${who} from ${fmtLocal(saved.start ?? iso(startMs), scheduleZone)} to ${fmtLocal(saved.end ?? iso(endMs), scheduleZone)}.`);
    await reload();
    onClose();
  };

  return html`<${Dialog} title="Schedule an override" opener=${opener} onClose=${onClose}>
    <h2>Schedule an override</h2>
    <form noValidate onSubmit=${(event) => { event.preventDefault(); save(); }}>
      <${Problems} errors=${errors} />
      <div class="field">
        <label for="person_id">Person</label>
        <select id="person_id" name="person_id" value=${person} onChange=${(event) => setPerson(event.target.value)}>
          ${people.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
          <option value="">Nobody</option>
        </select>
        <${FieldError} errors=${errors} name="person_id" />
      </div>
      <div class="field">
        <label for="start">Starts</label>
        <input id="start" name="start" type="text" autocomplete="off" value=${starts} aria-describedby="override-hint"
          onInput=${(event) => setStarts(event.target.value)} onKeyDown=${stepper(starts, setStarts)} />
        <${FieldError} errors=${errors} name="start" />
      </div>
      <div class="field">
        <label for="end">Ends</label>
        <input id="end" name="end" type="text" autocomplete="off" value=${ends} aria-describedby="override-hint"
          onInput=${(event) => setEnds(event.target.value)} onKeyDown=${stepper(ends, setEnds)} />
        <${FieldError} errors=${errors} name="end" />
      </div>
      <p class="muted" id="override-hint">Times are ${zone}, written YYYY-MM-DD HH:MM. Up and Down move by 15 minutes.</p>
      <div class="toolbar">
        <${Button} onClick=${save}>Save override</${Button}>
        <button type="button" class="secondary" onClick=${onClose}>Cancel</button>
      </div>
    </form>
  </${Dialog}>`;
}
