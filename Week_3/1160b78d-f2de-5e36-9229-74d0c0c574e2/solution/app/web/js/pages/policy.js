import { html, useState, useEffect, useRef } from '../lib/html.js';
import { boot, me } from '../lib/boot.js';
import { api, fieldErrors } from '../lib/api.js';
import { live } from '../lib/live.js';
import { Button, Empty, Problems, FieldError } from '../lib/ui.js';
import { listAll, byName, canEditPolicies } from './service/data.js';
import { useReorder } from './policy/reorder.js';
import { Level } from './policy/level.js';

const STALE = 'Someone saved a newer version. Reload to see it.';
const NOT_FOUND = 'We could not find that page.';

let counter = 0;
const nextCid = () => 'level-' + ++counter;

function toLevels(record, known) {
  return record.levels.map((lv) => ({
    cid: nextCid(),
    timeout: String(lv.timeout_minutes),
    targets: lv.targets.map((t) => ({ type: t.type, id: t.id, name: t.name ?? known.get(t.type + ':' + t.id) ?? t.id })),
  }));
}

function toBody(name, repeats, levels) {
  const body = { name, levels: levels.map((lv) => {
    const level = { targets: lv.targets.map((t) => ({ type: t.type, id: t.id })) };
    if (lv.timeout.trim() !== '') level.timeout_minutes = Number(lv.timeout);
    return level;
  }) };
  if (repeats.trim() !== '') body.repeats = Number(repeats);
  return body;
}

// Which level a field error sits under: the first level that breaks the rule the sentence is about.
function errorSlots(errors, levels) {
  const slots = levels.map(() => ({}));
  if (errors?.timeout_minutes && levels.length) {
    const at = levels.findIndex((lv) => {
      const n = Number(lv.timeout);
      return lv.timeout.trim() !== '' && (!Number.isInteger(n) || n < (lv.targets.length > 1 ? 3 : 1));
    });
    slots[Math.max(at, 0)].timeout = true;
  }
  if (errors?.targets && levels.length) {
    const at = levels.findIndex((lv) => lv.targets.length < 1 || lv.targets.length > 10);
    slots[Math.max(at, 0)].targets = true;
  }
  return slots;
}

function Editor({ record, people, schedules }) {
  const editable = canEditPolicies(me);
  const known = new Map([...people.map((p) => ['person:' + p.id, p.name]), ...schedules.map((x) => ['schedule:' + x.id, x.name])]);
  const [name, setName] = useState(record.name);
  const [title, setTitle] = useState(record.name);
  const [repeats, setRepeats] = useState(String(record.repeats));
  const [levels, setLevels] = useState(() => toLevels(record, known));
  const [version, setVersion] = useState(record.version);
  const [errors, setErrors] = useState(null);
  const [notice, setNotice] = useState('');
  const listRef = useRef(null);
  const { handleProps, liftedCid, drag } = useReorder(levels, setLevels, listRef);
  const slots = errorSlots(errors, levels);

  const change = (index, next) => setLevels(levels.map((lv, i) => (i === index ? next : lv)));
  const save = async () => {
    const res = await api.put('/api/policies/' + record.id, toBody(name, repeats, levels), { version });
    if (res.ok) {
      const saved = res.data;
      setErrors(null);
      setNotice(`${saved.running_incidents} running incidents keep version ${version}. Version ${saved.version} applies to later incidents.`);
      setVersion(saved.version);
      setName(saved.name);
      setTitle(saved.name);
      setRepeats(String(saved.repeats));
      setLevels(toLevels(saved, known));
      live.announce('Saved.');
    } else if (res.status === 412) {
      setErrors(null);
      setNotice(STALE);
      live.announce(STALE);
    } else if (fieldErrors(res)) {
      setErrors(fieldErrors(res));
    }
  };

  return html`<section class="policy-editor">
    <h1 class="policy-title">${title}</h1>
    <p class="policy-version muted">${'Version ' + version}</p>
    <${Problems} errors=${errors} />
    <div class="policy-head">
      <div class="field">
        <label for="name">Policy name</label>
        <input id="name" type="text" value=${name} readOnly=${!editable} onInput=${(e) => setName(e.target.value)} />
        <${FieldError} errors=${errors} name="name" />
      </div>
      <div class="field">
        <label for="repeats">Repeats</label>
        <input id="repeats" type="number" inputmode="numeric" min="0" max="9" step="1" value=${repeats} readOnly=${!editable}
          onInput=${(e) => setRepeats(e.target.value)} />
        <${FieldError} errors=${errors} name="repeats" />
      </div>
    </div>
    <p id="move-help" class="sr-only">Press Space to lift this level, Up or Down to move it, Space to drop it, Escape to put it back.</p>
    <ol id="levels" tabindex="-1" role="list" aria-label="Levels" class="levels" ref=${listRef}>
      ${levels.map((lv, i) => html`<${Level} key=${lv.cid} level=${lv} position=${i + 1} editable=${editable} people=${people}
        schedules=${schedules} errors=${errors} errorSlots=${slots[i]} handle=${editable ? handleProps(lv.cid) : null}
        lifted=${liftedCid === lv.cid} dragging=${drag?.cid === lv.cid} over=${drag !== null && drag.over === i && drag.cid !== lv.cid}
        onChange=${(next) => change(i, next)} onRemove=${() => setLevels(levels.filter((_, j) => j !== i))} />`)}
    </ol>
    <${FieldError} errors=${errors} name="levels" />
    ${editable && html`<div class="toolbar policy-actions">
      <button type="button" class="secondary"
        onClick=${() => setLevels([...levels, { cid: nextCid(), timeout: '30', targets: [] }])}>Add level</button>
      <${Button} class="tab-accent" onClick=${save}>Save policy</${Button}>
    </div>`}
    <section class="notice" aria-label="Policy notice">${notice}</section>
  </section>`;
}

export default function Policy() {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    (async () => {
      const [res, people, schedules] = await Promise.all([
        api.get('/api/policies/' + boot.params.id), listAll('/api/users'), listAll('/api/schedules'),
      ]);
      if (!res.ok) {
        setState({ missing: true });
        return;
      }
      setState({
        record: res.data,
        people: (people ?? []).filter((p) => p.role !== 'stakeholder').sort(byName),
        schedules: (schedules ?? []).sort(byName),
      });
    })();
  }, []);
  if (state.loading) return html`<h1 class="policy-title">Policy</h1>`;
  if (state.missing) return html`<${Empty}>${NOT_FOUND}</${Empty}>`;
  return html`<${Editor} record=${state.record} people=${state.people} schedules=${state.schedules} />`;
}
